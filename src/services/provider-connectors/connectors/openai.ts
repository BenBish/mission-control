import { providerBaseUrl, resolveOpenAIAdminKey } from "../credentials.js";
import { providerFetchJson, unixSeconds } from "../http.js";
import {
  mergeOpenAIRows,
  normalizeOpenAICompletionsUsage,
  normalizeOpenAICosts,
} from "../normalize/openai.js";
import type {
  FetchImpl,
  FetchWindow,
  ProviderConnector,
  ProviderFetchResult,
} from "../types.js";

export const openaiConnector: ProviderConnector = {
  id: "openai",
  displayName: "OpenAI",

  isConfigured() {
    return !!resolveOpenAIAdminKey();
  },

  async fetchUsage(
    window: FetchWindow,
    fetchImpl: FetchImpl = fetch,
  ): Promise<ProviderFetchResult> {
    const key = resolveOpenAIAdminKey();
    if (!key) return { rows: [] };

    const base = providerBaseUrl("openai", "https://api.openai.com/v1");
    const startTime = unixSeconds(window.start);
    const endTime = unixSeconds(window.end);
    const headers = {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    };

    const usageQs = new URLSearchParams({
      start_time: String(startTime),
      end_time: String(endTime),
      bucket_width: "1d",
      limit: "31",
    });
    usageQs.append("group_by[]", "model");

    const usagePayload = await providerFetchJson(
      "openai",
      `${base}/organization/usage/completions?${usageQs}`,
      { headers },
      fetchImpl,
    );

    let costRows = [] as ReturnType<typeof normalizeOpenAICosts>;
    try {
      const costQs = new URLSearchParams({
        start_time: String(startTime),
        end_time: String(endTime),
        bucket_width: "1d",
        limit: "31",
      });
      costQs.append("group_by[]", "line_item");
      const costPayload = await providerFetchJson(
        "openai",
        `${base}/organization/costs?${costQs}`,
        { headers },
        fetchImpl,
      );
      costRows = normalizeOpenAICosts(costPayload);
    } catch {
      // Costs may fail if key lacks cost scope; keep usage rows.
    }

    const usageRows = normalizeOpenAICompletionsUsage(usagePayload);
    return { rows: mergeOpenAIRows(usageRows, costRows) };
  },
};
