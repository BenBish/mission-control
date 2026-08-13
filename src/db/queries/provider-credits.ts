/**
 * Persist and read provider credit / balance / capacity snapshots.
 * Never mixed into session-log costUsd or provider_usage_daily spend sums.
 */

import type { Database as SqliteDatabase } from "sqlite";
import { capacitySurfaceOf } from "../../services/provider-connectors/normalize/credits.js";
import { evaluateCreditFreshness } from "../../services/provider-connectors/normalize/credits-freshness.js";
import {
  PERSISTED_CREDIT_STATUSES,
  type CapacitySurface,
  type CreditSnapshot,
  type CreditStatus,
  type CreditUnit,
  type PersistedCreditStatus,
  type ProviderId,
} from "../../services/provider-connectors/types.js";

const PERSISTED_CREDIT_STATUS_SET = new Set<string>(PERSISTED_CREDIT_STATUSES);

/**
 * Map a CreditStatus to a value the table CHECK will accept.
 * `stale`/`expired` are read-time freshness over an originally-ok observation.
 */
export function toPersistedCreditStatus(
  status: CreditStatus | string,
): PersistedCreditStatus {
  if (PERSISTED_CREDIT_STATUS_SET.has(status)) {
    return status as PersistedCreditStatus;
  }
  return "ok";
}

export interface ProviderCreditSnapshotRow {
  id: number;
  provider: string;
  as_of: string;
  remaining: number | null;
  total: number | null;
  unit: string;
  label: string;
  source: string;
  status: string;
  details_json: string | null;
  updated_at: string | null;
}

/** Idempotent upsert by (provider, label, as_of). */
export async function upsertProviderCreditSnapshot(
  db: SqliteDatabase,
  snap: CreditSnapshot,
): Promise<void> {
  const surface = snap.surface ?? capacitySurfaceOf(snap);
  const details = {
    ...(snap.details ?? {}),
    surface,
  };
  const detailsJson = JSON.stringify(details);

  await db.run(
    `
    INSERT INTO provider_credit_snapshots (
      provider, as_of, remaining, total, unit, label, source, status, details_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(provider, label, as_of) DO UPDATE SET
      remaining = excluded.remaining,
      total = excluded.total,
      unit = excluded.unit,
      source = excluded.source,
      status = excluded.status,
      details_json = excluded.details_json,
      updated_at = CURRENT_TIMESTAMP
    `,
    snap.provider,
    snap.asOf,
    snap.remaining,
    snap.total ?? null,
    snap.unit,
    snap.label,
    snap.source,
    toPersistedCreditStatus(snap.status),
    detailsJson,
  );
}

/**
 * Delete all credit snapshots for a provider + label (e.g. drop
 * plan_usage_unavailable once real session-quota rows exist).
 */
export async function deleteProviderCreditSnapshotsByLabel(
  db: SqliteDatabase,
  provider: ProviderId | string,
  label: string,
): Promise<number> {
  const result = await db.run(
    `DELETE FROM provider_credit_snapshots WHERE provider = ? AND label = ?`,
    provider,
    label,
  );
  return result.changes ?? 0;
}

/** Latest snapshot per (provider, label). */
export async function latestProviderCreditSnapshots(
  db: SqliteDatabase,
  opts: { provider?: ProviderId } = {},
): Promise<ProviderCreditSnapshotRow[]> {
  const params: unknown[] = [];
  let providerClause = "";
  if (opts.provider) {
    providerClause = "AND provider = ?";
    params.push(opts.provider);
  }
  return db.all<ProviderCreditSnapshotRow[]>(
    `
    SELECT p.*
    FROM provider_credit_snapshots p
    INNER JOIN (
      SELECT provider, label, MAX(as_of) AS max_as_of
      FROM provider_credit_snapshots
      WHERE 1=1 ${providerClause}
      GROUP BY provider, label
    ) latest
      ON p.provider = latest.provider
     AND p.label = latest.label
     AND p.as_of = latest.max_as_of
    ORDER BY p.provider, p.label
    `,
    ...(params as []),
  );
}

export async function listProviderCreditHistory(
  db: SqliteDatabase,
  opts: { provider?: ProviderId; limit?: number } = {},
): Promise<ProviderCreditSnapshotRow[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (opts.provider) {
    clauses.push("provider = ?");
    params.push(opts.provider);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  return db.all<ProviderCreditSnapshotRow[]>(
    `
    SELECT * FROM provider_credit_snapshots
    ${where}
    ORDER BY as_of DESC, provider, label
    LIMIT ${limit}
    `,
    ...(params as []),
  );
}

export function rowToApiCredit(
  row: ProviderCreditSnapshotRow,
  /** Optional clock for tests. Do not pass this via Array#map (index is 2nd arg). */
  now?: Date,
): {
  provider: string;
  asOf: string;
  remaining: number | null;
  total: number | null;
  unit: CreditUnit | string;
  label: string;
  source: string;
  status: CreditStatus | string;
  /** plan_usage | wallet — never API org spend */
  surface: CapacitySurface;
  details: Record<string, unknown> | null;
  updatedAt: string | null;
} {
  let details: Record<string, unknown> | null = null;
  if (row.details_json) {
    try {
      details = JSON.parse(row.details_json) as Record<string, unknown>;
    } catch {
      details = null;
    }
  }
  const surface = capacitySurfaceOf({
    surface:
      details?.surface === "plan_usage" || details?.surface === "wallet"
        ? details.surface
        : undefined,
    source: row.source,
    unit: row.unit,
    label: row.label,
  });

  // BSH-96: never surface obsolete plan-usage windows as green "ok"
  const clock = now instanceof Date ? now : new Date();
  const freshness = evaluateCreditFreshness(
    {
      status: row.status,
      asOf: row.as_of,
      surface,
      source: row.source,
      label: row.label,
      details,
    },
    clock,
  );
  if (freshness.freshnessReason) {
    details = {
      ...(details ?? {}),
      freshnessReason: freshness.freshnessReason,
    };
  }

  return {
    provider: row.provider,
    asOf: row.as_of,
    remaining: row.remaining,
    total: row.total,
    unit: row.unit,
    label: row.label,
    source: row.source,
    status: freshness.status,
    surface,
    details,
    updatedAt: row.updated_at,
  };
}
