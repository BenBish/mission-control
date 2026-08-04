import {
  providerBaseUrl,
  resolveOpenAIAdminKey,
  resolveOpenAIApiKey,
} from "../credentials.js";
import { providerFetchJson, unixSeconds } from "../http.js";
import { normalizeOpenAICreditGrants } from "../normalize/credits.js";
import {
  mergeOpenAIRows,
  normalizeOpenAICompletionsUsage,
  normalizeOpenAICosts,
} from "../normalize/openai.js";
import type {
  CreditFetchResult,
  FetchImpl,
  FetchWindow,
  ProviderConnector,
  ProviderFetchResult,
} from "../types.js";
import { ProviderHttpError } from "../types.js";

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

  /**
   * Prepaid USD balance via undocumented dashboard credit_grants.
   * Prefer OPENAI_API_KEY; fall back to admin key. Admin Usage APIs do not
   * expose remaining balance — only spend history.
   */
  async fetchCredits(fetchImpl: FetchImpl = fetch): Promise<CreditFetchResult> {
    const keys = [resolveOpenAIApiKey(), resolveOpenAIAdminKey()].filter(
      (k): k is string => !!k,
    );

    if (keys.length === 0) {
      return {
        snapshots: [],
        limitation:
          "No OPENAI_API_KEY or OPENAI_ADMIN_KEY for credit_grants; Codex session quotas may still populate usage-window capacity.",
      };
    }

    const base = providerBaseUrl("openai", "https://api.openai.com/v1");
    const url = `${base}/dashboard/billing/credit_grants`;
    const errors: string[] = [];

    for (const key of keys) {
      try {
        const payload = await providerFetchJson(
          "openai",
          url,
          {
            headers: {
              Authorization: `Bearer ${key}`,
              "Content-Type": "application/json",
            },
          },
          fetchImpl,
        );
        const snapshots = normalizeOpenAICreditGrants(payload);
        if (snapshots.length > 0) return { snapshots };
        errors.push("credit_grants returned no parseable balance fields");
      } catch (err) {
        const msg =
          err instanceof ProviderHttpError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err);
        errors.push(msg);
      }
    }

    return {
      snapshots: [
        {
          provider: "openai",
          asOf: new Date().toISOString(),
          remaining: null,
          total: null,
          unit: "usd",
          label: "prepaid_balance",
          source: "unavailable",
          status: "unavailable",
          details: {
            endpoint: "dashboard/billing/credit_grants",
            note: "Undocumented; Admin costs API reports spend only, not remaining balance.",
            attempts: errors.slice(0, 3),
          },
        },
      ],
      limitation:
        "OpenAI prepaid balance unavailable (credit_grants failed or returned empty). Codex usage-window quotas are separate.",
    };
  },
};
