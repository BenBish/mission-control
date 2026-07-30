import type { Database as SqliteDatabase } from "sqlite";

export interface FailureItem {
  kind: "activity" | "inference_request" | "runtime_event";
  id: string;
  sourceId: string;
  timestamp: string;
  summary: string;
  detail?: string;
}

export interface FailureSummary {
  total: number;
  last24Hours: number;
  openRuntimeEvents: number;
  byKind: {
    activity: number;
    inference_request: number;
    runtime_event: number;
  };
  definitions: {
    total: string;
    last24Hours: string;
    openRuntimeEvents: string;
    statusScope: string;
  };
}

interface FailureUnionRow {
  kind: "activity" | "inference_request" | "runtime_event";
  id: string;
  source_id: string;
  timestamp: string;
  summary: string;
  detail: string | null;
}

const FAILURE_DEFINITIONS = {
  total: "all-time matching failures",
  last24Hours: "matching failures with timestamp >= now-24h",
  openRuntimeEvents:
    "runtime_events with severity != info and ended_at IS NULL",
  statusScope: "activity failure | inference non-success | runtime non-info",
} as const;

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
  const sourceClause = sourceId ? "AND source_id = ?" : "";
  const sourceParams = sourceId ? [sourceId] : [];

  // Each arm projects a common shape; runtime info severity is excluded
  // (same as the previous post-filter on severity !== 'info').
  const sql = `
    SELECT kind, id, source_id, timestamp, summary, detail FROM (
      SELECT
        'activity' AS kind,
        id,
        source_id,
        timestamp,
        description AS summary,
        json_extract(result, '$.error') AS detail
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
        error AS detail
      FROM inference_requests
      WHERE status != 'success' ${sourceClause}

      UNION ALL

      SELECT
        'runtime_event' AS kind,
        id,
        source_id,
        timestamp,
        summary,
        details AS detail
      FROM runtime_events
      WHERE severity != 'info' ${sourceClause}
    )
    ORDER BY timestamp DESC
    LIMIT ?
  `;

  // Each UNION arm needs its own source param when filtering.
  const params = sourceId
    ? [...sourceParams, ...sourceParams, ...sourceParams, limit]
    : [limit];

  const rows = await db.all<FailureUnionRow[]>(sql, ...(params as []));

  return rows.map((row) => ({
    kind: row.kind,
    id: row.id,
    sourceId: row.source_id,
    timestamp: row.timestamp,
    summary: row.summary,
    detail: row.detail ?? undefined,
  }));
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
