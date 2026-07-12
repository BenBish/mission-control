import type { Database as SqliteDatabase } from "sqlite";

export interface ConsumptionRow {
  day: string;
  source_id: string;
  model: string | null;
  unit: "quota" | "compute" | "usd";
  input_tokens: number;
  output_tokens: number;
  compute_seconds: number;
  cost_usd: number | null;
}

/**
 * Daily consumption grouped by (day, source, model), one row per unit the
 * source actually reports in. Never fabricates a dollar figure — cost_usd is
 * only non-null where a row's own cost_usd was populated.
 *
 * This is the runtime equivalent of the plan's v_consumption_daily view —
 * implemented as a parameterized query rather than a persisted SQL VIEW so
 * it can take a date-range filter without a second query layer on top.
 */
export async function getDailyConsumption(
  db: SqliteDatabase,
  opts: { since?: string; sourceId?: string } = {},
): Promise<ConsumptionRow[]> {
  const activityClauses: string[] = [];
  const activityParams: unknown[] = [];
  if (opts.since) {
    activityClauses.push("a.timestamp >= ?");
    activityParams.push(opts.since);
  }
  if (opts.sourceId) {
    activityClauses.push("a.source_id = ?");
    activityParams.push(opts.sourceId);
  }
  const activityWhere = activityClauses.length
    ? `WHERE ${activityClauses.join(" AND ")}`
    : "";

  const inferenceClauses: string[] = [];
  const inferenceParams: unknown[] = [];
  if (opts.since) {
    inferenceClauses.push("i.timestamp >= ?");
    inferenceParams.push(opts.since);
  }
  if (opts.sourceId) {
    inferenceClauses.push("i.source_id = ?");
    inferenceParams.push(opts.sourceId);
  }
  const inferenceWhere = inferenceClauses.length
    ? `WHERE ${inferenceClauses.join(" AND ")}`
    : "";

  return db.all<ConsumptionRow[]>(
    `
    SELECT
      date(a.timestamp) AS day,
      a.source_id,
      a.model,
      s.default_unit AS unit,
      SUM(COALESCE(a.input_tokens, 0)) AS input_tokens,
      SUM(COALESCE(a.output_tokens, 0)) AS output_tokens,
      0 AS compute_seconds,
      CASE WHEN SUM(a.cost_usd) IS NULL THEN NULL ELSE SUM(a.cost_usd) END AS cost_usd
    FROM activities a
    JOIN sources s ON s.id = a.source_id
    ${activityWhere}
    GROUP BY day, a.source_id, a.model

    UNION ALL

    SELECT
      date(i.timestamp) AS day,
      i.source_id,
      i.model,
      s.default_unit AS unit,
      SUM(COALESCE(i.prompt_tokens, 0)) AS input_tokens,
      SUM(COALESCE(i.completion_tokens, 0)) AS output_tokens,
      SUM(COALESCE(i.duration_ms, 0)) / 1000.0 AS compute_seconds,
      NULL AS cost_usd
    FROM inference_requests i
    JOIN sources s ON s.id = i.source_id
    ${inferenceWhere}
    GROUP BY day, i.source_id, i.model

    ORDER BY day DESC
    `,
    ...([...activityParams, ...inferenceParams] as []),
  );
}
