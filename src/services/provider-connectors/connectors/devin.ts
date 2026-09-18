import { resolveDevinCredentials } from "../credentials.js";
import { devinCreditsUnavailable } from "../normalize/credits.js";
import type {
  CreditFetchResult,
  ProviderConnector,
  ProviderFetchResult,
} from "../types.js";

/**
 * Devin (devin.ai / Devin CLI) connector.
 *
 * Devin has no public historical usage/cost API for self-serve plans —
 * usage accrues in ACUs (Agent Compute Units), visible in the product or
 * through enterprise-only consumption endpoints. This connector:
 *
 * 1. Reports configured when the Devin CLI credential file exists
 *    (~/.local/share/devin/credentials.toml) or MC_DEVIN_API_KEY is set.
 * 2. Returns no usage rows — agent-session usage for Devin is collected
 *    by the desktop collector (src/collectors/devin/) from sessions.db.
 * 3. Plan usage: devin quota_snapshots are bridged in sync.ts
 *    (`SESSION_QUOTA_SOURCE_BY_PROVIDER.devin = "devin"`). fetchCredits
 *    records wallet + plan placeholders as unavailable rather than
 *    inventing balances.
 */
export const devinConnector: ProviderConnector = {
  id: "devin",
  displayName: "Devin",

  isConfigured() {
    return !!resolveDevinCredentials();
  },

  async fetchUsage(): Promise<ProviderFetchResult> {
    return {
      rows: [],
      limitation:
        "Devin has no public historical usage API for self-serve plans; agent usage is collected from the local sessions.db by the desktop collector and plan capacity from the CLI GetUserStatus endpoint.",
    };
  },

  async fetchCredits(): Promise<CreditFetchResult> {
    if (!resolveDevinCredentials()) return { snapshots: [] };
    return devinCreditsUnavailable();
  },
};
