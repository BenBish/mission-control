import { providerBaseUrl, resolveOpenRouterKey } from "../credentials.js";
import { dayInWindow, providerFetchJson } from "../http.js";
import { normalizeOpenRouterCredits } from "../normalize/credits.js";
import { normalizeOpenRouterActivity } from "../normalize/openrouter.js";
import type {
  CreditFetchResult,
  FetchImpl,
  FetchWindow,
  ProviderConnector,
  ProviderFetchResult,
} from "../types.js";

export const openrouterConnector: ProviderConnector = {
  id: "openrouter",
  displayName: "OpenRouter",

  isConfigured() {
    return !!resolveOpenRouterKey();
  },

  async fetchUsage(
    window: FetchWindow,
    fetchImpl: FetchImpl = fetch,
  ): Promise<ProviderFetchResult> {
    const key = resolveOpenRouterKey();
    if (!key) {
      return { rows: [] };
    }
    const base = providerBaseUrl("openrouter", "https://openrouter.ai/api/v1");
    // Activity returns last 30 completed UTC days; optional date filter is per-day only.
    // We still filter client-side to honor the requested FetchWindow.
    const url = `${base}/activity`;
    const payload = await providerFetchJson(
      "openrouter",
      url,
      {
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
      },
      fetchImpl,
    );
    const rows = normalizeOpenRouterActivity(payload).filter((r) =>
      dayInWindow(r.day, window),
    );
    return { rows };
  },

  /**
   * Account credit wallet (BSH-93 surface #2) via official GET /api/v1/credits.
   * Management key recommended. Not a subscription plan-usage window.
   */
  async fetchCredits(fetchImpl: FetchImpl = fetch): Promise<CreditFetchResult> {
    const key = resolveOpenRouterKey();
    if (!key) return { snapshots: [] };

    const base = providerBaseUrl("openrouter", "https://openrouter.ai/api/v1");
    const payload = await providerFetchJson(
      "openrouter",
      `${base}/credits`,
      {
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
      },
      fetchImpl,
    );
    const snapshots = normalizeOpenRouterCredits(payload);
    if (snapshots.length === 0) {
      return {
        snapshots: [
          {
            provider: "openrouter",
            asOf: new Date().toISOString(),
            remaining: null,
            total: null,
            unit: "usd",
            label: "prepaid_balance",
            source: "unavailable",
            status: "unavailable",
            surface: "wallet",
            details: {
              endpoint: "/api/v1/credits",
              note: "OpenRouter /credits returned no parseable total_credits/total_usage fields.",
            },
          },
        ],
        limitation:
          "OpenRouter credits payload missing total_credits/total_usage",
      };
    }
    return { snapshots };
  },
};
