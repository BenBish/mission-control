/**
 * Normalize xAI usage export payloads.
 *
 * xAI does not currently publish a public historical usage/billing API.
 * We accept a simple JSON export shape (dashboard export or custom endpoint
 * via MC_XAI_USAGE_ENDPOINT) so the connector surface stays consistent.
 */

import type { NormalizedUsageRow } from "../types.js";

export interface XaiUsageItem {
  date?: string;
  day?: string;
  model?: string;
  input_tokens?: number;
  prompt_tokens?: number;
  output_tokens?: number;
  completion_tokens?: number;
  cost_usd?: number;
  cost?: number;
  requests?: number;
  request_count?: number;
}

export interface XaiUsagePayload {
  data?: XaiUsageItem[];
  usage?: XaiUsageItem[];
}

export function normalizeXaiUsage(payload: unknown): NormalizedUsageRow[] {
  const body = payload as XaiUsagePayload;
  const items = Array.isArray(body?.data)
    ? body.data
    : Array.isArray(body?.usage)
      ? body.usage
      : Array.isArray(payload)
        ? (payload as XaiUsageItem[])
        : [];

  const map = new Map<string, NormalizedUsageRow>();

  for (const item of items) {
    const day =
      (typeof item.date === "string" && item.date.slice(0, 10)) ||
      (typeof item.day === "string" && item.day.slice(0, 10)) ||
      null;
    if (!day) continue;
    const model =
      typeof item.model === "string" && item.model.trim()
        ? item.model.trim()
        : "unknown";
    const input = Number(item.input_tokens) || Number(item.prompt_tokens) || 0;
    const output =
      Number(item.output_tokens) || Number(item.completion_tokens) || 0;
    const costRaw = item.cost_usd ?? item.cost;
    const cost =
      costRaw == null || !Number.isFinite(Number(costRaw))
        ? null
        : Number(costRaw);
    const requests = Number(item.requests) || Number(item.request_count) || 0;

    const key = `${day}|${model}`;
    const existing = map.get(key);
    if (existing) {
      existing.inputTokens += input;
      existing.outputTokens += output;
      if (cost != null) existing.costUsd = (existing.costUsd ?? 0) + cost;
      existing.requestCount += requests;
    } else {
      map.set(key, {
        provider: "xai",
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
