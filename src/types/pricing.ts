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
 */
export const PRICING: PricingTable = {
  // OpenRouter - Claude models
  'openrouter/anthropic/claude-haiku-4.5': {
    inputCostPer1kTokens: 0.0008,
    outputCostPer1kTokens: 0.004,
  },
  'openrouter/anthropic/claude-3-haiku': {
    inputCostPer1kTokens: 0.00025,
    outputCostPer1kTokens: 0.00125,
  },
  'openrouter/anthropic/claude-3-sonnet': {
    inputCostPer1kTokens: 0.003,
    outputCostPer1kTokens: 0.015,
  },
  'openrouter/anthropic/claude-3-opus': {
    inputCostPer1kTokens: 0.015,
    outputCostPer1kTokens: 0.075,
  },

  // OpenRouter - Other providers (add as needed)
  'openrouter/openai/gpt-4-turbo': {
    inputCostPer1kTokens: 0.01,
    outputCostPer1kTokens: 0.03,
  },
  'openrouter/openai/gpt-3.5-turbo': {
    inputCostPer1kTokens: 0.0005,
    outputCostPer1kTokens: 0.0015,
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
