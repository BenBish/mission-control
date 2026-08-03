import type { Database as SqliteDatabase } from "sqlite";
import {
  computeFailureFingerprint,
  isFailureEventResolved,
  type FailureKind,
} from "../../lib/failure-fingerprint.js";
import type {
  FailureGroup,
  FailureItem,
  FailureResolution,
  FailureSummary,
} from "../../types/failures.js";

export type { FailureItem, FailureSummary, FailureGroup };

interface FailureUnionRow {
  kind: FailureKind;
  id: string;
  source_id: string;
  timestamp: string;
  summary: string;
  detail: string | null;
  ended_at: string | null;
  event_kind: string | null;
  severity: string | null;
  status: string | null;
  model: string | null;
}

const FAILURE_DEFINITIONS: FailureSummary["definitions"] = {
  total: "all-time matching failures",
  last24Hours: "matching failures with timestamp >= now-24h",
  openRuntimeEvents:
    "runtime_events with severity != info and ended_at IS NULL",
  statusScope: "activity failure | inference non-success | runtime non-info",
};

function safeLimit(limit: number | undefined, fallback = 50): number {
  return typeof limit === "number" &&
    Number.isFinite(limit) &&
    Number.isInteger(limit) &&
    limit > 0
    ? limit
    : fallback;
}

function safeOffset(offset: number | undefined): number {
  return typeof offset === "number" &&
    Number.isFinite(offset) &&
    Number.isInteger(offset) &&
    offset >= 0
    ? offset
    : 0;
}

/**
 * Shared UNION of activity failures + inference failures + runtime events.
 * Projects fingerprint inputs so grouping can run in the query layer.
 */
async function loadFailureUnionRows(
  db: SqliteDatabase,
  opts: {
    sourceId?: string;
    kind?: FailureKind;
  } = {},
): Promise<FailureUnionRow[]> {
  const sourceClause = opts.sourceId ? "AND source_id = ?" : "";
  const sourceParams = opts.sourceId ? [opts.sourceId] : [];

  const arms: string[] = [];
  const params: string[] = [];

  if (!opts.kind || opts.kind === "activity") {
    arms.push(`
      SELECT
        'activity' AS kind,
        id,
        source_id,
        timestamp,
        description AS summary,
        json_extract(result, '$.error') AS detail,
        NULL AS ended_at,
        NULL AS event_kind,
        NULL AS severity,
        status AS status,
        NULL AS model
      FROM activities
      WHERE status = 'failure' ${sourceClause}
    `);
    params.push(...sourceParams);
  }

  if (!opts.kind || opts.kind === "inference_request") {
    arms.push(`
      SELECT
        'inference_request' AS kind,
        id,
        source_id,
        timestamp,
        (status || ' on ' || COALESCE(model, 'unknown model') ||
          ' (' || COALESCE(client_label, 'unknown client') || ')') AS summary,
        error AS detail,
        NULL AS ended_at,
        NULL AS event_kind,
        NULL AS severity,
        status AS status,
        model AS model
      FROM inference_requests
      WHERE status != 'success' ${sourceClause}
    `);
    params.push(...sourceParams);
  }

  if (!opts.kind || opts.kind === "runtime_event") {
    arms.push(`
      SELECT
        'runtime_event' AS kind,
        id,
        source_id,
        timestamp,
        summary,
        details AS detail,
        ended_at,
        kind AS event_kind,
        severity,
        NULL AS status,
        NULL AS model
      FROM runtime_events
      WHERE severity != 'info' ${sourceClause}
    `);
    params.push(...sourceParams);
  }

  if (arms.length === 0) return [];

  const sql = `
    SELECT kind, id, source_id, timestamp, summary, detail,
           ended_at, event_kind, severity, status, model
    FROM (
      ${arms.join("\nUNION ALL\n")}
    )
    ORDER BY timestamp DESC
  `;

  return db.all<FailureUnionRow[]>(sql, ...(params as []));
}

function rowToItem(row: FailureUnionRow): FailureItem {
  const fingerprint = computeFailureFingerprint({
    kind: row.kind,
    sourceId: row.source_id,
    summary: row.summary,
    detail: row.detail,
    eventKind: row.event_kind,
    severity: row.severity,
    status: row.status,
    model: row.model,
  });
  const resolved = isFailureEventResolved({
    kind: row.kind,
    endedAt: row.ended_at,
  });
  return {
    kind: row.kind,
    id: row.id,
    sourceId: row.source_id,
    timestamp: row.timestamp,
    summary: row.summary,
    detail: row.detail ?? undefined,
    endedAt: row.ended_at ?? undefined,
    fingerprint,
    resolved,
  };
}

/**
 * Union of activity failures + inference failures + runtime_events.
 * Single ordered UNION ALL + LIMIT so we do not over-fetch `limit` rows
 * from each table then re-slice. Optional sourceId is applied in SQL.
 */
export async function listRecentFailures(
  db: SqliteDatabase,
  limit = 50,
  sourceId?: string,
): Promise<FailureItem[]> {
  const safe = safeLimit(limit, 50);
  const sourceClause = sourceId ? "AND source_id = ?" : "";
  const sourceParams = sourceId ? [sourceId] : [];

  const sql = `
    SELECT kind, id, source_id, timestamp, summary, detail,
           ended_at, event_kind, severity, status, model
    FROM (
      SELECT
        'activity' AS kind,
        id,
        source_id,
        timestamp,
        description AS summary,
        json_extract(result, '$.error') AS detail,
        NULL AS ended_at,
        NULL AS event_kind,
        NULL AS severity,
        status AS status,
        NULL AS model
      FROM activities
      WHERE status = 'failure' ${sourceClause}

      UNION ALL

      SELECT
        'inference_request' AS kind,
        id,
        source_id,
        timestamp,
        (status || ' on ' || COALESCE(model, 'unknown model') ||
          ' (' || COALESCE(client_label, 'unknown client') || ')') AS summary,
        error AS detail,
        NULL AS ended_at,
        NULL AS event_kind,
        NULL AS severity,
        status AS status,
        model AS model
      FROM inference_requests
      WHERE status != 'success' ${sourceClause}

      UNION ALL

      SELECT
        'runtime_event' AS kind,
        id,
        source_id,
        timestamp,
        summary,
        details AS detail,
        ended_at,
        kind AS event_kind,
        severity,
        NULL AS status,
        NULL AS model
      FROM runtime_events
      WHERE severity != 'info' ${sourceClause}
    )
    ORDER BY timestamp DESC
    LIMIT ?
  `;

  const params = sourceId
    ? [...sourceParams, ...sourceParams, ...sourceParams, safe]
    : [safe];

  const rows = await db.all<FailureUnionRow[]>(sql, ...(params as []));
  return rows.map(rowToItem);
}

export interface ListFailureGroupsOpts {
  sourceId?: string;
  kind?: FailureKind;
  resolved?: FailureResolution;
  limit?: number;
  offset?: number;
}

/**
 * Group failures by stable fingerprint. Pagination applies to groups
 * (not raw events). Aggregate summary remains event-level.
 */
export async function listFailureGroups(
  db: SqliteDatabase,
  opts: ListFailureGroupsOpts = {},
): Promise<{ groups: FailureGroup[]; groupTotal: number }> {
  const limit = safeLimit(opts.limit, 50);
  const offset = safeOffset(opts.offset);

  const rows = await loadFailureUnionRows(db, {
    sourceId: opts.sourceId,
    kind: opts.kind,
  });

  type Acc = {
    fingerprint: string;
    kind: FailureKind;
    sourceId: string;
    summary: string;
    detail?: string;
    occurrenceCount: number;
    firstSeen: string;
    lastSeen: string;
    openCount: number;
  };

  const map = new Map<string, Acc>();

  for (const row of rows) {
    const item = rowToItem(row);
    const fp = item.fingerprint!;
    const existing = map.get(fp);
    if (!existing) {
      map.set(fp, {
        fingerprint: fp,
        kind: item.kind,
        sourceId: item.sourceId,
        summary: item.summary,
        detail: item.detail,
        occurrenceCount: 1,
        firstSeen: item.timestamp,
        lastSeen: item.timestamp,
        openCount: item.resolved ? 0 : 1,
      });
      continue;
    }
    existing.occurrenceCount += 1;
    if (item.timestamp > existing.lastSeen) {
      existing.lastSeen = item.timestamp;
      // Keep most-recent summary/detail as representative.
      existing.summary = item.summary;
      existing.detail = item.detail;
    }
    if (item.timestamp < existing.firstSeen) {
      existing.firstSeen = item.timestamp;
    }
    if (!item.resolved) existing.openCount += 1;
  }

  let groups: FailureGroup[] = [...map.values()].map((g) => ({
    fingerprint: g.fingerprint,
    kind: g.kind,
    sourceId: g.sourceId,
    summary: g.summary,
    detail: g.detail,
    occurrenceCount: g.occurrenceCount,
    firstSeen: g.firstSeen,
    lastSeen: g.lastSeen,
    openCount: g.openCount,
    resolved: g.openCount === 0,
  }));

  if (opts.resolved === "resolved") {
    groups = groups.filter((g) => g.resolved);
  } else if (opts.resolved === "unresolved") {
    groups = groups.filter((g) => !g.resolved);
  }

  groups.sort((a, b) => {
    if (a.lastSeen === b.lastSeen) {
      return b.occurrenceCount - a.occurrenceCount;
    }
    return a.lastSeen < b.lastSeen ? 1 : -1;
  });

  const groupTotal = groups.length;
  const page = groups.slice(offset, offset + limit);
  return { groups: page, groupTotal };
}

export interface ListFailureGroupEventsOpts {
  fingerprint: string;
  sourceId?: string;
  limit?: number;
  offset?: number;
}

/**
 * Individual events for a single fingerprint group (debug drill-down).
 */
export async function listFailureGroupEvents(
  db: SqliteDatabase,
  opts: ListFailureGroupEventsOpts,
): Promise<{ events: FailureItem[]; total: number }> {
  const limit = safeLimit(opts.limit, 50);
  const offset = safeOffset(opts.offset);

  // Fingerprint embeds kind + source; still apply optional source filter.
  const rows = await loadFailureUnionRows(db, { sourceId: opts.sourceId });
  const matched = rows
    .map(rowToItem)
    .filter((item) => item.fingerprint === opts.fingerprint);

  // Already ordered by timestamp DESC from SQL.
  const total = matched.length;
  const events = matched.slice(offset, offset + limit);
  return { events, total };
}

/**
 * Aggregate failure totals independent of list pagination.
 * Uses COUNT(*) per source table (same predicates as listRecentFailures)
 * so totals stay correct when the page is saturated.
 */
export async function getFailureSummary(
  db: SqliteDatabase,
  sourceId?: string,
  now: Date = new Date(),
): Promise<FailureSummary> {
  const sourceClause = sourceId ? "AND source_id = ?" : "";
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  async function count(
    table: "activities" | "inference_requests" | "runtime_events",
    statusClause: string,
    extraClause = "",
    extraParams: string[] = [],
  ): Promise<number> {
    const sql = `
      SELECT COUNT(*) AS n FROM ${table}
      WHERE ${statusClause} ${sourceClause} ${extraClause}
    `;
    const params = [...(sourceId ? [sourceId] : []), ...extraParams];
    const row = await db.get<{ n: number }>(sql, ...(params as []));
    return row?.n ?? 0;
  }

  const [
    activityTotal,
    activity24h,
    inferenceTotal,
    inference24h,
    runtimeTotal,
    runtime24h,
    openRuntimeEvents,
  ] = await Promise.all([
    count("activities", "status = 'failure'"),
    count("activities", "status = 'failure'", "AND timestamp >= ?", [since24h]),
    count("inference_requests", "status != 'success'"),
    count("inference_requests", "status != 'success'", "AND timestamp >= ?", [
      since24h,
    ]),
    count("runtime_events", "severity != 'info'"),
    count("runtime_events", "severity != 'info'", "AND timestamp >= ?", [
      since24h,
    ]),
    count("runtime_events", "severity != 'info'", "AND ended_at IS NULL"),
  ]);

  return {
    total: activityTotal + inferenceTotal + runtimeTotal,
    last24Hours: activity24h + inference24h + runtime24h,
    openRuntimeEvents,
    byKind: {
      activity: activityTotal,
      inference_request: inferenceTotal,
      runtime_event: runtimeTotal,
    },
    definitions: { ...FAILURE_DEFINITIONS },
  };
}
