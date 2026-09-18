import { anthropicConnector } from "./connectors/anthropic.js";
import { devinConnector } from "./connectors/devin.js";
import { openaiConnector } from "./connectors/openai.js";
import { openrouterConnector } from "./connectors/openrouter.js";
import { xaiConnector } from "./connectors/xai.js";
import type { ProviderConnector, ProviderId } from "./types.js";

export * from "./types.js";
export { credentialMeta } from "./credentials.js";
export {
  sanitizeMessage,
  dayInWindow,
  PROVIDER_FETCH_TIMEOUT_MS,
  providerFetchJson,
} from "./http.js";
export { normalizeOpenRouterActivity } from "./normalize/openrouter.js";
export {
  normalizeAnthropicUsage,
  normalizeAnthropicCost,
  mergeAnthropicRows,
} from "./normalize/anthropic.js";
export {
  normalizeOpenAICompletionsUsage,
  normalizeOpenAICosts,
  mergeOpenAIRows,
  normalizeOpenAILineItem,
} from "./normalize/openai.js";
export { normalizeXaiUsage } from "./normalize/xai.js";
export {
  capacitySurfaceOf,
  normalizeOpenRouterCredits,
  anthropicCreditsUnavailable,
  devinCreditsUnavailable,
  openaiWalletUnavailable,
  xaiCreditsLimited,
  normalizeSessionQuotaToCredits,
} from "./normalize/credits.js";
export {
  syncAllProviders,
  syncProvider,
  defaultFetchWindow,
  resetSyncInFlightForTests,
  SESSION_QUOTA_SOURCE_BY_PROVIDER,
} from "./sync.js";

export {
  openrouterConnector,
  anthropicConnector,
  openaiConnector,
  xaiConnector,
  devinConnector,
};

const CONNECTORS: ProviderConnector[] = [
  openrouterConnector,
  anthropicConnector,
  openaiConnector,
  xaiConnector,
  devinConnector,
];

export function getConnectors(): ProviderConnector[] {
  return CONNECTORS;
}

export function getConnector(id: ProviderId): ProviderConnector | undefined {
  return CONNECTORS.find((c) => c.id === id);
}
