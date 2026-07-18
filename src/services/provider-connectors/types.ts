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
