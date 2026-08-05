/**
 * Pure helpers for the Dashboard Direct API Spend card (BSH-69).
 *
 * Provider-billed cost is account-wide and must stay separate from
 * session-derived Agent Usage totals. Missing sync data and query failures
 * must never look like a true $0 result.
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
 * Inputs for formatting spend amounts. Distinguishes query failures from
 * true zero and from never-synced connectors.
 */
export type DirectApiSpendFormatInput = {
  totals: AggregatedProviderCost;
  pending: boolean;
  /** Breakdown query failed (HTTP) — never render as $0. */
  loadError: boolean;
  /** Status query failed — may still show breakdown totals when loaded. */
  statusError: boolean;
  /** Status still loading — avoid flashing "No synced spend" before true zero. */
  statusPending: boolean;
  hasSuccessfulSync: boolean;
  /** Successful breakdown response received (including empty array). */
  breakdownLoaded: boolean;
};

/**
 * Format the primary (today) spend value.
 * - Pending / status pending (empty totals): ellipsis
 * - Breakdown load error: em dash (not $0)
 * - Cost rows present: dollar amount (even if status failed)
 * - Successful sync + loaded empty: true $0.0000
 * - Status unavailable + empty: em dash
 * - Never synced: "No synced spend"
 */
export function formatDirectApiSpendPrimary(
  input: DirectApiSpendFormatInput,
): string {
  if (input.pending) return "…";
  if (input.loadError) return "—";
  if (input.totals.hasCost) {
    return `$${input.totals.cost.toFixed(4)}`;
  }
  // Empty totals: wait for status before deciding zero vs never-synced.
  if (input.statusPending && !input.hasSuccessfulSync) return "…";
  if (input.breakdownLoaded && input.hasSuccessfulSync) {
    return "$0.0000";
  }
  if (input.statusError) return "—";
  if (!input.hasSuccessfulSync) return "No synced spend";
  // hasSuccessfulSync but breakdown not loaded and not pending/error — rare.
  return "—";
}

/**
 * Format the trailing 30-day supporting amount.
 */
export function formatDirectApiSpend30d(
  input: DirectApiSpendFormatInput,
): string {
  if (input.pending) return "…";
  if (input.loadError) return "—";
  if (input.totals.hasCost) {
    return `$${input.totals.cost.toFixed(4)}`;
  }
  if (input.statusPending && !input.hasSuccessfulSync) return "…";
  if (input.breakdownLoaded && input.hasSuccessfulSync) {
    return "$0.0000";
  }
  return "—";
}

export type SyncStatusKind =
  | "error"
  | "stale"
  | "synced"
  | "none"
  | "status-unavailable";

export function directApiSpendSyncStatusKind(
  health: ProviderSyncHealth,
  statusError: boolean = false,
): SyncStatusKind {
  if (statusError) return "status-unavailable";
  if (health.hasError) return "error";
  if (health.isStale) return "stale";
  if (health.hasSuccessfulSync) return "synced";
  return "none";
}

/** Compact primary value uses smaller type (long “No synced spend” / em dash). */
export function isCompactSpendPrimary(primary: string): boolean {
  return primary !== "…" && !primary.startsWith("$");
}

/**
 * Local calendar day key — changes only at local midnight.
 * Prefer `utcDayKey` / `getProviderUsageSinceDay` for provider billing windows
 * (see `src/lib/date-range.ts`); local keys are for UI-only refresh cues.
 */
export function localDayKey(nowMs: number = Date.now()): string {
  const d = new Date(nowMs);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/**
 * ISO start of local calendar day (agent-style "today").
 * Do not use for provider day-key filters — local midnight serializes to the
 * prior UTC day in positive offsets (BSH-97). Use getProviderUsageSinceDay.
 */
export function startOfLocalDayIso(nowMs: number = Date.now()): string {
  const start = new Date(nowMs);
  start.setHours(0, 0, 0, 0);
  return start.toISOString();
}

/** ISO timestamp for trailing N days window start (absolute rolling). */
export function daysAgoIso(days: number, nowMs: number = Date.now()): string {
  return new Date(nowMs - days * 24 * 60 * 60 * 1000).toISOString();
}
