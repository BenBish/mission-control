/**
 * Normalize OpenRouter /api/v1/activity response into daily usage rows.
 * @see https://openrouter.ai/docs/api/api-reference/analytics/get-user-activity-grouped-by-endpoint
 */

import type { NormalizedUsageRow } from "../types.js";

export interface OpenRouterActivityItem {
  date?: string;
  model?: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  usage?: number;
  byok_usage_inference?: number;
  requests?: number;
}

export interface OpenRouterActivityResponse {
  data?: OpenRouterActivityItem[];
}

export function normalizeOpenRouterActivity(
  payload: unknown,
): NormalizedUsageRow[] {
  const body = payload as OpenRouterActivityResponse;
  const items = Array.isArray(body?.data) ? body.data : [];
  // Aggregate by (day, model) — activity can return multiple endpoint rows per model/day.
  const map = new Map<string, NormalizedUsageRow>();

  for (const item of items) {
    const day = typeof item.date === "string" ? item.date : null;
    const model =
      typeof item.model === "string" && item.model.trim()
        ? item.model.trim()
        : "unknown";
    if (!day) continue;

    const key = `${day}|${model}`;
    const existing = map.get(key);
    const input = Number(item.prompt_tokens) || 0;
    const output = Number(item.completion_tokens) || 0;
    const cost =
      (Number(item.usage) || 0) + (Number(item.byok_usage_inference) || 0);
    const requests = Number(item.requests) || 0;

    if (existing) {
      existing.inputTokens += input;
      existing.outputTokens += output;
      existing.costUsd = (existing.costUsd ?? 0) + cost;
      existing.requestCount += requests;
    } else {
      map.set(key, {
        provider: "openrouter",
        day,
        model,
        inputTokens: input,
        outputTokens: output,
        costUsd: cost,
        requestCount: requests,
      });
    }
  }

  return Array.from(map.values());
}
