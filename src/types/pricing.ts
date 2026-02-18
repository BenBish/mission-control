/**
 * Model Pricing Configuration
 * Primary cost data comes from session JSONL logs (exact per-request cost).
 * This module provides fallback pricing via OpenRouter API + static table.
 */

import fs from 'fs';
import path from 'path';

export interface ModelPricing {
  inputCostPer1kTokens: number;
  outputCostPer1kTokens: number;
}

export type PricingTable = Record<string, ModelPricing>;

/**
 * Static fallback pricing table for known models.
 * Prices are per 1k tokens in USD.
 */
const STATIC_PRICING: PricingTable = {
  'openrouter/anthropic/claude-sonnet-4.5': { inputCostPer1kTokens: 3.0, outputCostPer1kTokens: 15.0 },
  'openrouter/anthropic/claude-haiku-4.5': { inputCostPer1kTokens: 0.25, outputCostPer1kTokens: 1.25 },
  'openrouter/anthropic/claude-3-haiku': { inputCostPer1kTokens: 0.25, outputCostPer1kTokens: 1.25 },
  'openrouter/anthropic/claude-3-sonnet': { inputCostPer1kTokens: 3.0, outputCostPer1kTokens: 15.0 },
  'openrouter/anthropic/claude-3-opus': { inputCostPer1kTokens: 15.0, outputCostPer1kTokens: 75.0 },
  'openrouter/moonshotai/kimi-k2.5': { inputCostPer1kTokens: 0.5, outputCostPer1kTokens: 2.0 },
  'openrouter/minimax/minimax-m2.5': { inputCostPer1kTokens: 0.2, outputCostPer1kTokens: 0.8 },
  'openrouter/openai/gpt-4-turbo': { inputCostPer1kTokens: 10.0, outputCostPer1kTokens: 30.0 },
  'openrouter/openai/gpt-3.5-turbo': { inputCostPer1kTokens: 0.5, outputCostPer1kTokens: 1.5 },
  'default': { inputCostPer1kTokens: 0, outputCostPer1kTokens: 0 },
};

// Live pricing cache from OpenRouter API
let apiPricingCache: PricingTable = {};
let apiPricingLastFetch: Date | null = null;
const API_REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Combined pricing: API cache takes precedence, then static fallback.
 */
export const PRICING: PricingTable = new Proxy({} as PricingTable, {
  get(_target, prop: string) {
    return apiPricingCache[prop] || STATIC_PRICING[prop] || STATIC_PRICING['default'];
  },
  has(_target, prop: string) {
    return prop in apiPricingCache || prop in STATIC_PRICING;
  },
  ownKeys() {
    return [...new Set([...Object.keys(apiPricingCache), ...Object.keys(STATIC_PRICING)])];
  },
  getOwnPropertyDescriptor(_target, prop: string) {
    const value = apiPricingCache[prop as string] || STATIC_PRICING[prop as string];
    if (value) return { configurable: true, enumerable: true, value };
    return undefined;
  },
});

/**
 * Initialize pricing by fetching from OpenRouter API.
 * Falls back silently to static table on failure.
 */
export async function initializePricing(apiKey?: string): Promise<void> {
  const key = apiKey || resolveApiKey();
  if (!key) {
    console.log('[Pricing] No OpenRouter API key found, using static pricing table');
    return;
  }

  await refreshApiPricing(key);

  // Schedule hourly refresh
  setInterval(() => refreshApiPricing(key), API_REFRESH_INTERVAL_MS);
}

/**
 * Fetch pricing from OpenRouter API and update cache
 */
async function refreshApiPricing(apiKey: string): Promise<void> {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });

    if (!response.ok) {
      console.warn(`[Pricing] OpenRouter API returned ${response.status}, keeping cached pricing`);
      return;
    }

    const data = await response.json() as { data: Array<{ id: string; pricing?: { prompt: string; completion: string } }> };

    const newCache: PricingTable = {};
    for (const model of data.data) {
      if (model.pricing?.prompt && model.pricing?.completion) {
        // OpenRouter prices are per-token strings; convert to per-1k-tokens numbers
        const inputPerToken = parseFloat(model.pricing.prompt);
        const outputPerToken = parseFloat(model.pricing.completion);
        if (!isNaN(inputPerToken) && !isNaN(outputPerToken)) {
          // Store with openrouter/ prefix to match our model ID format
          newCache[`openrouter/${model.id}`] = {
            inputCostPer1kTokens: inputPerToken * 1000,
            outputCostPer1kTokens: outputPerToken * 1000,
          };
          // Also store without prefix for matching JSONL model IDs
          newCache[model.id] = {
            inputCostPer1kTokens: inputPerToken * 1000,
            outputCostPer1kTokens: outputPerToken * 1000,
          };
        }
      }
    }

    apiPricingCache = newCache;
    apiPricingLastFetch = new Date();
    console.log(`[Pricing] Updated pricing for ${Object.keys(newCache).length / 2} models from OpenRouter API`);
  } catch (err: any) {
    console.warn(`[Pricing] Failed to fetch from OpenRouter API: ${err.message}`);
  }
}

/**
 * Try to resolve OpenRouter API key from environment or auth-profiles
 */
function resolveApiKey(): string | null {
  // Check environment variable first
  if (process.env.OPENROUTER_API_KEY) {
    return process.env.OPENROUTER_API_KEY;
  }

  // Try reading from OpenClaw auth profiles
  try {
    const authPath = path.join(
      process.env.HOME || '',
      '.openclaw-team/agents/main/agent/auth-profiles.json'
    );
    if (fs.existsSync(authPath)) {
      const authData = JSON.parse(fs.readFileSync(authPath, 'utf-8'));
      // Look for OpenRouter profile
      const orProfile = authData?.profiles?.['openrouter:default'] || authData?.profiles?.openrouter;
      if (orProfile?.apiKey) {
        return orProfile.apiKey;
      }
    }
  } catch {
    // Silently ignore auth file read errors
  }

  return null;
}

/**
 * Get pricing cache status
 */
export function getPricingStatus(): {
  source: 'api' | 'static';
  lastFetch: string | null;
  modelCount: number;
} {
  return {
    source: apiPricingLastFetch ? 'api' : 'static',
    lastFetch: apiPricingLastFetch?.toISOString() ?? null,
    modelCount: Object.keys(apiPricingCache).length / 2 || Object.keys(STATIC_PRICING).length,
  };
}

/**
 * Calculate cost for a given model and token counts
 */
export function calculateCost(
  model: string | undefined,
  inputTokens: number = 0,
  outputTokens: number = 0
): number {
  if (!model || !inputTokens && !outputTokens) {
    return 0;
  }

  const pricing = PRICING[model] || PRICING['default'];

  const inputCost = (inputTokens / 1000) * pricing.inputCostPer1kTokens;
  const outputCost = (outputTokens / 1000) * pricing.outputCostPer1kTokens;

  return inputCost + outputCost;
}

/**
 * Get pricing for a model
 */
export function getPricing(model: string): ModelPricing {
  return PRICING[model] || PRICING['default'];
}
