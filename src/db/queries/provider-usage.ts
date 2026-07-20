import type { Database as SqliteDatabase } from "sqlite";
import type {
  ProviderId,
  SyncStatusValue,
} from "../../services/provider-connectors/types.js";

export interface ProviderUsageRow {
  provider: string;
  day: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number | null;
  request_count: number;
  updated_at: string | null;
}

export interface ProviderSyncStatusRow {
  provider: string;
  status: SyncStatusValue;
  last_sync_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  cursor_day: string | null;
  meta_json: string | null;
  updated_at: string | null;
}

/** Idempotent upsert — re-syncing the same (provider, day, model) overwrites. */
export async function upsertProviderUsage(
  db: SqliteDatabase,
  row: {
    provider: ProviderId;
    day: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number | null;
    requestCount: number;
  },
): Promise<void> {
  await db.run(
    `
    INSERT INTO provider_usage_daily (
      provider, day, model, input_tokens, output_tokens, cost_usd, request_count, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(provider, day, model) DO UPDATE SET
      input_tokens = excluded.input_tokens,
      output_tokens = excluded.output_tokens,
      cost_usd = excluded.cost_usd,
      request_count = excluded.request_count,
      updated_at = CURRENT_TIMESTAMP
    `,
    row.provider,
    row.day,
    row.model,
    row.inputTokens,
    row.outputTokens,
    row.costUsd,
    row.requestCount,
  );
}

/**
 * After upserting a sync batch for a given provider+day, remove models that
 * are no longer present in the latest API response so re-syncs do not inflate
 * totals with renamed/removed line items.
 */
export async function pruneStaleProviderUsageModels(
  db: SqliteDatabase,
  provider: ProviderId,
  day: string,
  keepModels: string[],
): Promise<number> {
  if (keepModels.length === 0) {
    const result = await db.run(
      `DELETE FROM provider_usage_daily WHERE provider = ? AND day = ?`,
      provider,
      day,
    );
    return result.changes ?? 0;
  }
  const placeholders = keepModels.map(() => "?").join(", ");
  const result = await db.run(
    `DELETE FROM provider_usage_daily
     WHERE provider = ? AND day = ? AND model NOT IN (${placeholders})`,
    provider,
    day,
    ...keepModels,
  );
  return result.changes ?? 0;
}

export async function upsertProviderSyncStatus(
  db: SqliteDatabase,
  row: {
    provider: ProviderId;
    status: SyncStatusValue;
    lastSyncAt?: string | null;
    lastSuccessAt?: string | null;
    lastError?: string | null;
    cursorDay?: string | null;
    meta?: Record<string, unknown> | null;
  },
): Promise<void> {
  const existing = await db.get<ProviderSyncStatusRow>(
    `SELECT * FROM provider_sync_status WHERE provider = ?`,
    row.provider,
  );

  const lastSyncAt =
    row.lastSyncAt !== undefined
      ? row.lastSyncAt
      : (existing?.last_sync_at ?? null);
  const lastSuccessAt =
    row.lastSuccessAt !== undefined
      ? row.lastSuccessAt
      : (existing?.last_success_at ?? null);
  const lastError =
    row.lastError !== undefined
      ? row.lastError
      : (existing?.last_error ?? null);
  const cursorDay =
    row.cursorDay !== undefined
      ? row.cursorDay
      : (existing?.cursor_day ?? null);
  const metaJson =
    row.meta !== undefined
      ? row.meta
        ? JSON.stringify(row.meta)
        : null
      : (existing?.meta_json ?? null);

  await db.run(
    `
    INSERT INTO provider_sync_status (
      provider, status, last_sync_at, last_success_at, last_error, cursor_day, meta_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(provider) DO UPDATE SET
      status = excluded.status,
      last_sync_at = excluded.last_sync_at,
      last_success_at = excluded.last_success_at,
      last_error = excluded.last_error,
      cursor_day = excluded.cursor_day,
      meta_json = excluded.meta_json,
      updated_at = CURRENT_TIMESTAMP
    `,
    row.provider,
    row.status,
    lastSyncAt,
    lastSuccessAt,
    lastError,
    cursorDay,
    metaJson,
  );
}

export async function listProviderSyncStatus(
  db: SqliteDatabase,
): Promise<ProviderSyncStatusRow[]> {
  return db.all<ProviderSyncStatusRow[]>(
    `SELECT * FROM provider_sync_status ORDER BY provider`,
  );
}

export async function getProviderUsage(
  db: SqliteDatabase,
  opts: { since?: string; provider?: string } = {},
): Promise<ProviderUsageRow[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (opts.since) {
    // since may be ISO datetime — compare on day prefix
    const day = opts.since.slice(0, 10);
    clauses.push("day >= ?");
    params.push(day);
  }
  if (opts.provider) {
    clauses.push("provider = ?");
    params.push(opts.provider);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return db.all<ProviderUsageRow[]>(
    `
    SELECT provider, day, model, input_tokens, output_tokens, cost_usd, request_count, updated_at
    FROM provider_usage_daily
    ${where}
    ORDER BY day DESC, provider, model
    `,
    ...(params as []),
  );
}

/** Aggregate usage for breakdown by provider + model over a range. */
export async function getProviderUsageBreakdown(
  db: SqliteDatabase,
  opts: { since?: string; provider?: string } = {},
): Promise<
  Array<{
    provider: string;
    model: string;
    input_tokens: number;
    output_tokens: number;
    cost_usd: number | null;
    request_count: number;
  }>
> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (opts.since) {
    clauses.push("day >= ?");
    params.push(opts.since.slice(0, 10));
  }
  if (opts.provider) {
    clauses.push("provider = ?");
    params.push(opts.provider);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return db.all(
    `
    SELECT
      provider,
      model,
      SUM(input_tokens) AS input_tokens,
      SUM(output_tokens) AS output_tokens,
      CASE WHEN SUM(cost_usd) IS NULL THEN NULL ELSE SUM(cost_usd) END AS cost_usd,
      SUM(request_count) AS request_count
    FROM provider_usage_daily
    ${where}
    GROUP BY provider, model
    ORDER BY SUM(COALESCE(cost_usd, 0)) DESC, SUM(input_tokens + output_tokens) DESC
    `,
    ...(params as []),
  );
}
