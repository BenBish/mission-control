/**
 * Pricing Tests
 * Verifies cost calculation, pricing table lookup, and fallback behavior
 */

import {
  calculateCost,
  getPricing,
  getPricingStatus,
  initializePricing,
  PRICING,
} from "../../types/pricing.js";

// Mock fetch for API tests
const realFetch = global.fetch;
global.fetch = jest.fn();

describe("Pricing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    // This file replaces global.fetch for the whole process (bun test runs
    // all files in one process) — restore it so later test files that need
    // a real fetch() aren't left talking to this mock.
    global.fetch = realFetch;
  });

  describe("calculateCost", () => {
    test("should calculate cost for known model", () => {
      const cost = calculateCost(
        "openrouter/anthropic/claude-haiku-4.5",
        1000,
        500,
      );

      // Haiku pricing: $0.25 per 1k input, $1.25 per 1k output
      // Input: 1000/1000 * 0.25 = 0.25
      // Output: 500/1000 * 1.25 = 0.625
      // Total: 0.875
      expect(cost).toBeCloseTo(0.875, 3);
    });

    test("should calculate cost for multiple models", () => {
      const haikuCost = calculateCost(
        "openrouter/anthropic/claude-haiku-4.5",
        2000,
        2000,
      );
      const opusCost = calculateCost(
        "openrouter/anthropic/claude-3-opus",
        2000,
        2000,
      );

      // Opus should be more expensive than Haiku
      expect(opusCost).toBeGreaterThan(haikuCost);
    });

    test("should return zero for unknown model", () => {
      const cost = calculateCost("unknown/model/name", 1000, 1000);
      expect(cost).toBe(0);
    });

    test("should return zero when model is undefined", () => {
      const cost = calculateCost(undefined, 1000, 1000);
      expect(cost).toBe(0);
    });

    test("should return zero when no tokens", () => {
      const cost = calculateCost("openrouter/anthropic/claude-haiku-4.5", 0, 0);
      expect(cost).toBe(0);
    });

    test("should calculate cost with only input tokens", () => {
      const cost = calculateCost(
        "openrouter/anthropic/claude-haiku-4.5",
        1000,
        0,
      );
      expect(cost).toBeCloseTo(0.25, 3);
    });

    test("should calculate cost with only output tokens", () => {
      const cost = calculateCost(
        "openrouter/anthropic/claude-haiku-4.5",
        0,
        1000,
      );
      expect(cost).toBeCloseTo(1.25, 3);
    });

    test("should handle fractional tokens correctly", () => {
      const cost = calculateCost(
        "openrouter/anthropic/claude-haiku-4.5",
        500,
        250,
      );
      // Input: 500/1000 * 0.25 = 0.125
      // Output: 250/1000 * 1.25 = 0.3125
      expect(cost).toBeCloseTo(0.4375, 4);
    });
  });

  describe("getPricing", () => {
    test("should return pricing for known model", () => {
      const pricing = getPricing("openrouter/anthropic/claude-haiku-4.5");

      expect(pricing.inputCostPer1kTokens).toBe(0.25);
      expect(pricing.outputCostPer1kTokens).toBe(1.25);
    });

    test("should return default pricing for unknown model", () => {
      const pricing = getPricing("unknown/model");

      expect(pricing.inputCostPer1kTokens).toBe(0);
      expect(pricing.outputCostPer1kTokens).toBe(0);
    });
  });

  describe("Static Pricing Table", () => {
    test("should have pricing for Claude models", () => {
      expect(PRICING["openrouter/anthropic/claude-haiku-4.5"]).toBeTruthy();
      expect(PRICING["openrouter/anthropic/claude-sonnet-4.5"]).toBeTruthy();
      expect(PRICING["openrouter/anthropic/claude-3-opus"]).toBeTruthy();
    });

    test("should have pricing for OpenAI models", () => {
      expect(PRICING["openrouter/openai/gpt-4-turbo"]).toBeTruthy();
      expect(PRICING["openrouter/openai/gpt-3.5-turbo"]).toBeTruthy();
    });

    test("should recognize Grok models without fabricating fallback cost", () => {
      expect(PRICING["grok-4.5"]).toEqual({
        inputCostPer1kTokens: 0,
        outputCostPer1kTokens: 0,
      });
      expect(PRICING["grok-build"]).toEqual({
        inputCostPer1kTokens: 0,
        outputCostPer1kTokens: 0,
      });
    });

    test("should have default pricing entry", () => {
      expect(PRICING["default"]).toBeTruthy();
      expect(PRICING["default"].inputCostPer1kTokens).toBe(0);
      expect(PRICING["default"].outputCostPer1kTokens).toBe(0);
    });

    test("Haiku should be cheaper than Sonnet", () => {
      const haiku = PRICING["openrouter/anthropic/claude-haiku-4.5"];
      const sonnet = PRICING["openrouter/anthropic/claude-sonnet-4.5"];

      expect(haiku.inputCostPer1kTokens).toBeLessThan(
        sonnet.inputCostPer1kTokens,
      );
      expect(haiku.outputCostPer1kTokens).toBeLessThan(
        sonnet.outputCostPer1kTokens,
      );
    });

    test("Sonnet should be cheaper than Opus", () => {
      const sonnet = PRICING["openrouter/anthropic/claude-sonnet-4.5"];
      const opus = PRICING["openrouter/anthropic/claude-3-opus"];

      expect(sonnet.inputCostPer1kTokens).toBeLessThan(
        opus.inputCostPer1kTokens,
      );
      expect(sonnet.outputCostPer1kTokens).toBeLessThan(
        opus.outputCostPer1kTokens,
      );
    });
  });

  describe("initializePricing", () => {
    test("should return without error when no API key", async () => {
      delete process.env.OPENROUTER_API_KEY;

      // Should resolve without throwing
      await initializePricing();
    });

    test("should fetch pricing from OpenRouter API", async () => {
      const mockResponse = {
        data: [
          {
            id: "anthropic/claude-haiku-4.5",
            pricing: {
              prompt: "0.00025",
              completion: "0.00125",
            },
          },
        ],
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      await initializePricing("test-api-key");

      expect(global.fetch).toHaveBeenCalledWith(
        "https://openrouter.ai/api/v1/models",
        expect.objectContaining({
          headers: { Authorization: "Bearer test-api-key" },
        }),
      );
    });

    test("should handle API error gracefully", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      // Should resolve without throwing
      await initializePricing("test-api-key");
    });

    test("should handle network error gracefully", async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(
        new Error("Network error"),
      );

      // Should resolve without throwing
      await initializePricing("test-api-key");
    });
  });

  describe("getPricingStatus", () => {
    test("should return pricing status with model count", () => {
      const status = getPricingStatus();

      // Source can be 'static' or 'api' depending on test order
      expect(["static", "api"]).toContain(status.source);
      expect(status.modelCount).toBeGreaterThan(0);
    });
  });

  describe("Model Pricing Comparisons", () => {
    test("should have correct relative pricing", () => {
      const models = [
        {
          name: "claude-haiku-4.5",
          key: "openrouter/anthropic/claude-haiku-4.5",
        },
        {
          name: "claude-sonnet-4.5",
          key: "openrouter/anthropic/claude-sonnet-4.5",
        },
        { name: "claude-3-opus", key: "openrouter/anthropic/claude-3-opus" },
      ];

      const costs = models.map((m) => ({
        ...m,
        cost: calculateCost(m.key, 1000, 1000),
      }));

      // Sort by cost
      costs.sort((a, b) => a.cost - b.cost);

      // Haiku < Sonnet < Opus
      expect(costs[0].name).toBe("claude-haiku-4.5");
      expect(costs[1].name).toBe("claude-sonnet-4.5");
      expect(costs[2].name).toBe("claude-3-opus");
    });

    test("should calculate realistic costs", () => {
      // 1M input tokens on Haiku
      const haiku1M = calculateCost(
        "openrouter/anthropic/claude-haiku-4.5",
        1_000_000,
        0,
      );
      expect(haiku1M).toBe(250); // $250 per 1M tokens

      // 1M output tokens on Haiku
      const haiku1MOut = calculateCost(
        "openrouter/anthropic/claude-haiku-4.5",
        0,
        1_000_000,
      );
      expect(haiku1MOut).toBe(1250); // $1.25k per 1M tokens
    });
  });
});
