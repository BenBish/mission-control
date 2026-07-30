/**
 * Pure helpers for the Dashboard Direct API Spend card (BSH-69).
 *
 * Provider-billed cost is account-wide and must stay separate from
 * session-derived Agent Usage totals. Missing sync data must never look
 * like a true $0 result.
 */

/** Consider provider billing data stale after this long without a success. */
export const PROVIDER_SYNC_STALE_MS = 24 * 60 * 60 * 1000;

export type ProviderCostRow = {
  cost_usd: number | null;
};

export type AggregatedProviderCost = {
  cost: number;
  /** True when at least one row reports a non-null cost_usd. */
  hasCost: boolean;
};

export function aggregateProviderCost(
  rows: ProviderCostRow[] | null | undefined,
): AggregatedProviderCost {
  if (!rows?.length) return { cost: 0, hasCost: false };
  let cost = 0;
  let hasCost = false;
  for (const row of rows) {
    if (row.cost_usd != null) {
      hasCost = true;
      cost += row.cost_usd;
    }
  }
  return { cost, hasCost };
}

export type ProviderSyncSummaryInput = {
  configured: boolean;
  status: string;
  lastSuccessAt: string | null;
  lastError: string | null;
};

export type ProviderSyncHealth = {
  /** Latest lastSuccessAt across configured connectors. */
  lastSuccessAt: string | null;
  isStale: boolean;
  hasError: boolean;
  errorMessage: string | null;
  hasSuccessfulSync: boolean;
  anyConfigured: boolean;
};

/**
 * Summarize connector health for the homepage spend card.
 * Only configured providers participate in error/stale/sync checks.
 */
export function summarizeProviderSync(
  providers: ProviderSyncSummaryInput[] | null | undefined,
  nowMs: number,
  staleMs: number = PROVIDER_SYNC_STALE_MS,
): ProviderSyncHealth {
  const configured = (providers ?? []).filter((p) => p.configured);
  let lastSuccessAt: string | null = null;
  let lastSuccessMs = -1;
  let hasError = false;
  let errorMessage: string | null = null;

  for (const p of configured) {
    if (p.status === "error") {
      hasError = true;
      if (p.lastError && !errorMessage) {
        errorMessage = p.lastError;
      }
    }
    if (p.lastSuccessAt) {
      const t = new Date(p.lastSuccessAt).getTime();
      if (!Number.isNaN(t) && t > lastSuccessMs) {
        lastSuccessMs = t;
        lastSuccessAt = p.lastSuccessAt;
      }
    }
  }

  const hasSuccessfulSync = lastSuccessAt != null;
  const isStale =
    hasSuccessfulSync && lastSuccessMs >= 0 && nowMs - lastSuccessMs > staleMs;

  return {
    lastSuccessAt,
    isStale,
    hasError,
    errorMessage,
    hasSuccessfulSync,
    anyConfigured: configured.length > 0,
  };
}

/**
 * Format the primary spend value.
 * - Pending: ellipsis
 * - Never successfully synced: "No synced spend" (not $0)
 * - After a successful sync: always a dollar amount (including true $0.0000)
 */
export function formatDirectApiSpendPrimary(
  totals: AggregatedProviderCost,
  health: Pick<ProviderSyncHealth, "hasSuccessfulSync">,
  pending: boolean,
): string {
  if (pending) return "…";
  if (!health.hasSuccessfulSync) return "No synced spend";
  return `$${totals.cost.toFixed(4)}`;
}

/**
 * Format the trailing 30-day supporting amount.
 * Uses em dash when there has never been a successful sync.
 */
export function formatDirectApiSpend30d(
  totals: AggregatedProviderCost,
  health: Pick<ProviderSyncHealth, "hasSuccessfulSync">,
  pending: boolean,
): string {
  if (pending) return "…";
  if (!health.hasSuccessfulSync) return "—";
  return `$${totals.cost.toFixed(4)}`;
}

export type SyncStatusKind = "error" | "stale" | "synced" | "none";

export function directApiSpendSyncStatusKind(
  health: ProviderSyncHealth,
): SyncStatusKind {
  if (health.hasError) return "error";
  if (health.isStale) return "stale";
  if (health.hasSuccessfulSync) return "synced";
  return "none";
}

/** ISO start of local calendar day (matches Consumption "today" preset). */
export function startOfLocalDayIso(nowMs: number = Date.now()): string {
  const start = new Date(nowMs);
  start.setHours(0, 0, 0, 0);
  return start.toISOString();
}

/** ISO timestamp for trailing N days window start. */
export function daysAgoIso(days: number, nowMs: number = Date.now()): string {
  return new Date(nowMs - days * 24 * 60 * 60 * 1000).toISOString();
}
