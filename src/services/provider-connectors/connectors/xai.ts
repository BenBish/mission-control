import { providerBaseUrl, resolveXaiKey } from "../credentials.js";
import { providerFetchJson } from "../http.js";
import { normalizeXaiUsage } from "../normalize/xai.js";
import type {
  FetchImpl,
  FetchWindow,
  ProviderConnector,
  ProviderFetchResult,
} from "../types.js";

/**
 * xAI has no documented public historical usage API (as of implementation).
 * Behaviour:
 * 1. If MC_XAI_USAGE_ENDPOINT is set, GET that URL with Bearer auth and normalize JSON.
 * 2. Else verify the API key via GET /v1/models and return empty rows with a limitation note.
 */
export const xaiConnector: ProviderConnector = {
  id: "xai",
  displayName: "xAI",

  isConfigured() {
    return !!resolveXaiKey();
  },

  async fetchUsage(
    _window: FetchWindow,
    fetchImpl: FetchImpl = fetch,
  ): Promise<ProviderFetchResult> {
    const key = resolveXaiKey();
    if (!key) return { rows: [] };

    const customEndpoint = process.env.MC_XAI_USAGE_ENDPOINT?.trim();
    if (customEndpoint) {
      const payload = await providerFetchJson(
        "xai",
        customEndpoint,
        {
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
        },
        fetchImpl,
      );
      return { rows: normalizeXaiUsage(payload) };
    }

    // Connectivity check — proves the key works without inventing usage data.
    const base = providerBaseUrl("xai", "https://api.x.ai/v1");
    await providerFetchJson(
      "xai",
      `${base}/models`,
      {
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
      },
      fetchImpl,
    );

    return {
      rows: [],
      limitation:
        "xAI has no public historical usage/cost API; key verified via /models. Set MC_XAI_USAGE_ENDPOINT to a JSON usage export URL when available.",
    };
  },
};
