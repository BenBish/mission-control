/**
 * Shared types for provider usage/cost API connectors.
 * API-sourced billing data — distinct from session-log llm_generations.
 */

export const PROVIDER_IDS = [
  "openrouter",
  "anthropic",
  "openai",
  "xai",
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export interface NormalizedUsageRow {
  provider: ProviderId;
  /** UTC calendar day YYYY-MM-DD */
  day: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Null when the provider API does not return a dollar amount for this row. */
  costUsd: number | null;
  requestCount: number;
}

export interface FetchWindow {
  start: Date;
  end: Date;
}

export interface ProviderFetchResult {
  rows: NormalizedUsageRow[];
  /**
   * When set, sync stores status=limited (e.g. xAI has no public usage history API).
   * Not an error — connector is configured but metrics are partial/unavailable.
   */
  limitation?: string;
}

/** Unit for prepaid balance / capacity (not agent session costUsd). */
export const CREDIT_UNITS = [
  "usd",
  "credits",
  "requests",
  "tokens",
  "percent",
] as const;
export type CreditUnit = (typeof CREDIT_UNITS)[number];

export type CreditSource = "provider_api" | "session_quota" | "unavailable";
/** Connector outcomes that may be written to `provider_credit_snapshots.status`. */
export const PERSISTED_CREDIT_STATUSES = [
  "ok",
  "limited",
  "unavailable",
  "error",
] as const;
export type PersistedCreditStatus = (typeof PERSISTED_CREDIT_STATUSES)[number];
/**
 * API/UI status. `stale` / `expired` are read-time freshness only
 * (`evaluateCreditFreshness` in rowToApiCredit) and must never be persisted —
 * the table CHECK matches `PersistedCreditStatus`, not this full union.
 */
export type CreditStatus = PersistedCreditStatus | "stale" | "expired";
/**
 * BSH-93 product surface — do not collapse plan windows with prepaid wallets.
 * API org spend is `provider_usage_daily` / Direct API Spend, not this type.
 */
export type CapacitySurface = "plan_usage" | "wallet";

/**
 * Normalized remaining capacity / prepaid balance snapshot.
 * Distinct from NormalizedUsageRow (daily spend) and session costUsd.
 */
export interface CreditSnapshot {
  provider: ProviderId;
  /** ISO timestamp when this observation was taken. */
  asOf: string;
  /** Remaining capacity; null when the provider cannot report a number. */
  remaining: number | null;
  /** Optional total / grant size. */
  total?: number | null;
  unit: CreditUnit;
  /** Stable label within a provider (e.g. prepaid_balance, codex_5h). */
  label: string;
  source: CreditSource;
  status: CreditStatus;
  /** Plan usage windows vs prepaid usage-credits wallet (BSH-93). */
  surface: CapacitySurface;
  /** Redacted metadata only — never secrets. */
  details?: Record<string, unknown>;
}

export interface CreditFetchResult {
  snapshots: CreditSnapshot[];
  /**
   * When set without ok snapshots, sync records limited/unavailable credits
   * (e.g. Anthropic Admin API has no public balance endpoint).
   */
  limitation?: string;
}

export type FetchImpl = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface ProviderConnector {
  id: ProviderId;
  displayName: string;
  /** True when required env credentials are present (does not validate the key). */
  isConfigured(): boolean;
  /**
   * Fetch and normalize usage/cost for the window.
   * Throws ProviderHttpError on auth/rate-limit/server failures.
   * Inject fetchImpl in tests; production uses global fetch.
   */
  fetchUsage(
    window: FetchWindow,
    fetchImpl?: FetchImpl,
  ): Promise<ProviderFetchResult>;
  /**
   * Optional: fetch prepaid credits / remaining capacity.
   * When omitted, sync skips credit snapshots for this connector
   * (except session-quota enrichment for OpenAI/Codex).
   */
  fetchCredits?(fetchImpl?: FetchImpl): Promise<CreditFetchResult>;
}

export type SyncStatusValue =
  | "not_configured"
  | "ok"
  | "limited"
  | "error"
  | "syncing";

export class ProviderHttpError extends Error {
  constructor(
    public readonly provider: ProviderId,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ProviderHttpError";
  }
}

export function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(value);
}
