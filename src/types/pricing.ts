/**
 * Model Pricing Configuration
 * Used for cost calculation based on token usage
 */

export interface ModelPricing {
  inputCostPer1kTokens: number;
  outputCostPer1kTokens: number;
}

export type PricingTable = Record<string, ModelPricing>;

/**
 * Current pricing table for supported models
 * Update this as pricing changes
 * Prices are per 1k tokens in USD
 */
export const PRICING: PricingTable = {
  // OpenRouter - Claude models (Claude 4.5 series)
  'openrouter/anthropic/claude-sonnet-4.5': {
    inputCostPer1kTokens: 3.0,
    outputCostPer1kTokens: 15.0,
  },
  'openrouter/anthropic/claude-haiku-4.5': {
    inputCostPer1kTokens: 0.25,
    outputCostPer1kTokens: 1.25,
  },
  
  // Legacy Claude models
  'openrouter/anthropic/claude-3-haiku': {
    inputCostPer1kTokens: 0.25,
    outputCostPer1kTokens: 1.25,
  },
  'openrouter/anthropic/claude-3-sonnet': {
    inputCostPer1kTokens: 3.0,
    outputCostPer1kTokens: 15.0,
  },
  'openrouter/anthropic/claude-3-opus': {
    inputCostPer1kTokens: 15.0,
    outputCostPer1kTokens: 75.0,
  },

  // OpenRouter - Moonshot AI
  'openrouter/moonshotai/kimi-k2.5': {
    inputCostPer1kTokens: 0.5,
    outputCostPer1kTokens: 2.0,
  },

  // OpenRouter - MiniMax
  'openrouter/minimax/minimax-m2.5': {
    inputCostPer1kTokens: 0.2,
    outputCostPer1kTokens: 0.8,
  },

  // OpenRouter - Other providers
  'openrouter/openai/gpt-4-turbo': {
    inputCostPer1kTokens: 10.0,
    outputCostPer1kTokens: 30.0,
  },
  'openrouter/openai/gpt-3.5-turbo': {
    inputCostPer1kTokens: 0.5,
    outputCostPer1kTokens: 1.5,
  },

  // Default for unknown models
  'default': {
    inputCostPer1kTokens: 0,
    outputCostPer1kTokens: 0,
  },
};

/**
 * Calculate cost for a given model and token counts
 * @param model - Model identifier
 * @param inputTokens - Number of input tokens
 * @param outputTokens - Number of output tokens
 * @returns Cost in USD
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
 * @param model - Model identifier
 * @returns Pricing info or default if not found
 */
export function getPricing(model: string): ModelPricing {
  return PRICING[model] || PRICING['default'];
}
