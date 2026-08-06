/**
 * Agent Usage dimension queries (BSH-99).
 *
 * Reads activity + session fields needed for ranked drivers, coverage,
 * and session drill-down. Aggregation / model normalization happens in
 * the service layer so canonical identity stays pure TypeScript.
 */

import type { Database as SqliteDatabase } from "sqlite";

export type AgentUsageFactRow = {
  source_id: string;
  session_id: string;
  session_external_id: string | null;
  session_title: string | null;
  session_cwd: string | null;
  session_started_at: string | null;
  model: string | null;
  actor_id: string;
  actor_type: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cost_usd: number | null;
  request_count: number;
  activity_count: number;
};

export type AgentUsageRange = {
  since?: string;
  until?: string;
  sourceId?: string;
};

function buildActivityWhere(opts: AgentUsageRange): {
  where: string;
  params: unknown[];
} {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (opts.since) {
    clauses.push("a.timestamp >= ?");
    params.push(opts.since);
  }
  if (opts.until) {
    clauses.push("a.timestamp <= ?");
    params.push(opts.until);
  }
  if (opts.sourceId) {
    clauses.push("a.source_id = ?");
    params.push(opts.sourceId);
  }
  return {
    where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

/**
 * Per-(session, model, actor) activity aggregates in the range, unioned with
 * inference_request aggregates (Hermes/local runtime) which lack session/actor
 * dimensions. One row is a fact for the service layer to roll up by dimension.
 */
export async function listAgentUsageFacts(
  db: SqliteDatabase,
  opts: AgentUsageRange = {},
): Promise<AgentUsageFactRow[]> {
  const { where, params } = buildActivityWhere(opts);

  const infClauses: string[] = [];
  const infParams: unknown[] = [];
  if (opts.since) {
    infClauses.push("i.timestamp >= ?");
    infParams.push(opts.since);
  }
  if (opts.until) {
    infClauses.push("i.timestamp <= ?");
    infParams.push(opts.until);
  }
  if (opts.sourceId) {
    infClauses.push("i.source_id = ?");
    infParams.push(opts.sourceId);
  }
  const infWhere = infClauses.length ? `WHERE ${infClauses.join(" AND ")}` : "";

  return db.all<AgentUsageFactRow[]>(
    `
    SELECT
      a.source_id AS source_id,
      a.session_id AS session_id,
      s.external_id AS session_external_id,
      s.title AS session_title,
      s.cwd AS session_cwd,
      s.started_at AS session_started_at,
      a.model AS model,
      a.actor_id AS actor_id,
      a.actor_type AS actor_type,
      SUM(COALESCE(a.input_tokens, 0)) AS input_tokens,
      SUM(COALESCE(a.output_tokens, 0)) AS output_tokens,
      SUM(COALESCE(a.cache_read_tokens, 0)) AS cache_read_tokens,
      SUM(COALESCE(a.cache_write_tokens, 0)) AS cache_write_tokens,
      CASE
        WHEN SUM(a.cost_usd) IS NULL THEN NULL
        ELSE SUM(a.cost_usd)
      END AS cost_usd,
      COUNT(
        DISTINCT CASE
          WHEN a.request_id IS NOT NULL AND a.request_id != '' THEN a.request_id
          ELSE a.id
        END
      ) AS request_count,
      COUNT(*) AS activity_count
    FROM activities a
    LEFT JOIN sessions s ON s.id = a.session_id
    ${where}
    GROUP BY
      a.source_id,
      a.session_id,
      s.external_id,
      s.title,
      s.cwd,
      s.started_at,
      a.model,
      a.actor_id,
      a.actor_type

    UNION ALL

    SELECT
      i.source_id AS source_id,
      'inference:' || i.source_id || ':' || COALESCE(i.model, 'unknown')
        || ':' || COALESCE(i.client_label, 'unknown') AS session_id,
      NULL AS session_external_id,
      NULL AS session_title,
      NULL AS session_cwd,
      MIN(i.timestamp) AS session_started_at,
      i.model AS model,
      COALESCE(i.client_label, 'unknown') AS actor_id,
      'system' AS actor_type,
      SUM(COALESCE(i.prompt_tokens, 0)) AS input_tokens,
      SUM(COALESCE(i.completion_tokens, 0)) AS output_tokens,
      SUM(COALESCE(i.cached_tokens, 0)) AS cache_read_tokens,
      0 AS cache_write_tokens,
      NULL AS cost_usd,
      COUNT(*) AS request_count,
      COUNT(*) AS activity_count
    FROM inference_requests i
    ${infWhere}
    GROUP BY
      i.source_id,
      i.model,
      i.client_label
    `,
    ...([...params, ...infParams] as []),
  );
}

/**
 * Daily agent usage facts for spend reconciliation (BSH-101).
 * Grain: (UTC day of activity/inference timestamp, source, model).
 * Provider billing uses the same YYYY-MM-DD day keys (UTC).
 */
export type AgentUsageDailyFactRow = {
  day: string;
  source_id: string;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cost_usd: number | null;
  request_count: number;
};

export async function listAgentUsageDailyFacts(
  db: SqliteDatabase,
  opts: AgentUsageRange = {},
): Promise<AgentUsageDailyFactRow[]> {
  const { where, params } = buildActivityWhere(opts);

  const infClauses: string[] = [];
  const infParams: unknown[] = [];
  if (opts.since) {
    infClauses.push("i.timestamp >= ?");
    infParams.push(opts.since);
  }
  if (opts.until) {
    infClauses.push("i.timestamp <= ?");
    infParams.push(opts.until);
  }
  if (opts.sourceId) {
    infClauses.push("i.source_id = ?");
    infParams.push(opts.sourceId);
  }
  const infWhere = infClauses.length ? `WHERE ${infClauses.join(" AND ")}` : "";

  return db.all<AgentUsageDailyFactRow[]>(
    `
    SELECT
      date(a.timestamp) AS day,
      a.source_id AS source_id,
      a.model AS model,
      SUM(COALESCE(a.input_tokens, 0)) AS input_tokens,
      SUM(COALESCE(a.output_tokens, 0)) AS output_tokens,
      SUM(COALESCE(a.cache_read_tokens, 0)) AS cache_read_tokens,
      SUM(COALESCE(a.cache_write_tokens, 0)) AS cache_write_tokens,
      CASE
        WHEN SUM(a.cost_usd) IS NULL THEN NULL
        ELSE SUM(a.cost_usd)
      END AS cost_usd,
      COUNT(
        DISTINCT CASE
          WHEN a.request_id IS NOT NULL AND a.request_id != '' THEN a.request_id
          ELSE a.id
        END
      ) AS request_count
    FROM activities a
    ${where}
    GROUP BY date(a.timestamp), a.source_id, a.model

    UNION ALL

    SELECT
      date(i.timestamp) AS day,
      i.source_id AS source_id,
      i.model AS model,
      SUM(COALESCE(i.prompt_tokens, 0)) AS input_tokens,
      SUM(COALESCE(i.completion_tokens, 0)) AS output_tokens,
      SUM(COALESCE(i.cached_tokens, 0)) AS cache_read_tokens,
      0 AS cache_write_tokens,
      NULL AS cost_usd,
      COUNT(*) AS request_count
    FROM inference_requests i
    ${infWhere}
    GROUP BY date(i.timestamp), i.source_id, i.model

    ORDER BY day DESC
    `,
    ...([...params, ...infParams] as []),
  );
}

/**
 * Distinct sessions contributing to a driver key (for drill-down).
 * Filters are applied in the service after model/project normalization;
 * this returns session-level activity sums for the same time range.
 */
export async function listAgentUsageSessionFacts(
  db: SqliteDatabase,
  opts: AgentUsageRange = {},
): Promise<
  Array<{
    source_id: string;
    session_id: string;
    session_external_id: string | null;
    session_title: string | null;
    session_cwd: string | null;
    session_started_at: string | null;
    model: string | null;
    actor_id: string;
    actor_type: string;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_write_tokens: number;
    cost_usd: number | null;
    request_count: number;
  }>
> {
  // Same shape as listAgentUsageFacts — kept as alias for clarity at call sites.
  return listAgentUsageFacts(db, opts);
}
