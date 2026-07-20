import { providerBaseUrl, resolveAnthropicAdminKey } from "../credentials.js";
import { providerFetchJson, toUtcDay } from "../http.js";
import {
  mergeAnthropicRows,
  normalizeAnthropicCost,
  normalizeAnthropicUsage,
} from "../normalize/anthropic.js";
import type {
  FetchImpl,
  FetchWindow,
  ProviderConnector,
  ProviderFetchResult,
} from "../types.js";

export const anthropicConnector: ProviderConnector = {
  id: "anthropic",
  displayName: "Anthropic",

  isConfigured() {
    return !!resolveAnthropicAdminKey();
  },

  async fetchUsage(
    window: FetchWindow,
    fetchImpl: FetchImpl = fetch,
  ): Promise<ProviderFetchResult> {
    const key = resolveAnthropicAdminKey();
    if (!key) return { rows: [] };

    const base = providerBaseUrl("anthropic", "https://api.anthropic.com");
    const starting = toUtcDay(window.start) + "T00:00:00Z";
    // ending_at is exclusive; use start of tomorrow UTC so "today" is included.
    const endDay = new Date(window.end);
    endDay.setUTCDate(endDay.getUTCDate() + 1);
    const ending = toUtcDay(endDay) + "T00:00:00Z";
    const headers = {
      "anthropic-version": "2023-06-01",
      "x-api-key": key,
      "User-Agent": "MissionControl/1.0 (provider-connectors)",
    };

    // bucket_width=1d defaults to 7 buckets (max 31) — request the max so a
    // 30-day window is not silently truncated to one week.
    const usageQs = new URLSearchParams({
      starting_at: starting,
      ending_at: ending,
      bucket_width: "1d",
      limit: "31",
    });
    usageQs.append("group_by[]", "model");

    const usagePayload = await providerFetchJson(
      "anthropic",
      `${base}/v1/organizations/usage_report/messages?${usageQs}`,
      { headers },
      fetchImpl,
    );

    let costRows = [] as ReturnType<typeof normalizeAnthropicCost>;
    try {
      const costQs = new URLSearchParams({
        starting_at: starting,
        ending_at: ending,
        bucket_width: "1d",
        limit: "31",
      });
      costQs.append("group_by[]", "description");
      const costPayload = await providerFetchJson(
        "anthropic",
        `${base}/v1/organizations/cost_report?${costQs}`,
        { headers },
        fetchImpl,
      );
      costRows = normalizeAnthropicCost(costPayload);
    } catch {
      // Cost endpoint may require extra scopes; usage alone is still valuable.
    }

    const usageRows = normalizeAnthropicUsage(usagePayload);
    return { rows: mergeAnthropicRows(usageRows, costRows) };
  },
};
