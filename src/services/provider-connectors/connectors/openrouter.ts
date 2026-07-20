import { providerBaseUrl, resolveOpenRouterKey } from "../credentials.js";
import { dayInWindow, providerFetchJson } from "../http.js";
import { normalizeOpenRouterActivity } from "../normalize/openrouter.js";
import type {
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
};
