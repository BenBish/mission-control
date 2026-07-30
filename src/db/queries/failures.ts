import type { Database as SqliteDatabase } from "sqlite";

export interface FailureItem {
  kind: "activity" | "inference_request" | "runtime_event";
  id: string;
  sourceId: string;
  timestamp: string;
  summary: string;
  detail?: string;
}

interface FailureUnionRow {
  kind: "activity" | "inference_request" | "runtime_event";
  id: string;
  source_id: string;
  timestamp: string;
  summary: string;
  detail: string | null;
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
