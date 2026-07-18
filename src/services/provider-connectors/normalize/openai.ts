/**
 * Normalize OpenAI Organization Usage + Costs Admin API responses.
 * @see https://developers.openai.com/api/reference/resources/admin/
 */

import type { NormalizedUsageRow } from "../types.js";

interface CompletionsResult {
  object?: string;
  model?: string | null;
  input_tokens?: number;
  output_tokens?: number;
  num_model_requests?: number;
}

interface CostResult {
  object?: string;
  amount?: { value?: number; currency?: string } | null;
  line_item?: string | null;
  project_id?: string | null;
}

interface Bucket<T> {
  object?: string;
  start_time?: number;
  end_time?: number;
  results?: T[];
}

interface PageResponse<T> {
  object?: string;
  data?: Bucket<T>[];
}

function dayFromUnix(seconds: number | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds)) return null;
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

export function normalizeOpenAICompletionsUsage(
  payload: unknown,
): NormalizedUsageRow[] {
  const body = payload as PageResponse<CompletionsResult>;
  const buckets = Array.isArray(body?.data) ? body.data : [];
  const map = new Map<string, NormalizedUsageRow>();

  for (const bucket of buckets) {
    const day = dayFromUnix(bucket.start_time);
    if (!day) continue;
    for (const r of bucket.results ?? []) {
      if (
        r.object &&
        r.object !== "organization.usage.completions.result" &&
        !r.input_tokens &&
        !r.output_tokens
      ) {
        continue;
      }
      const model =
        typeof r.model === "string" && r.model.trim()
          ? r.model.trim()
          : "unknown";
      const input = Number(r.input_tokens) || 0;
      const output = Number(r.output_tokens) || 0;
      const requests = Number(r.num_model_requests) || 0;
      const key = `${day}|${model}`;
      const existing = map.get(key);
      if (existing) {
        existing.inputTokens += input;
        existing.outputTokens += output;
        existing.requestCount += requests;
      } else {
        map.set(key, {
          provider: "openai",
          day,
          model,
          inputTokens: input,
          outputTokens: output,
          costUsd: null,
          requestCount: requests,
        });
      }
    }
  }

  return Array.from(map.values());
}

export function normalizeOpenAICosts(payload: unknown): NormalizedUsageRow[] {
  const body = payload as PageResponse<CostResult>;
  const buckets = Array.isArray(body?.data) ? body.data : [];
  const map = new Map<string, NormalizedUsageRow>();

  for (const bucket of buckets) {
    const day = dayFromUnix(bucket.start_time);
    if (!day) continue;
    for (const r of bucket.results ?? []) {
      const model =
        (typeof r.line_item === "string" && r.line_item.trim()
          ? r.line_item.trim()
          : null) || "openai";
      const value = Number(r.amount?.value);
      const cost = Number.isFinite(value) ? value : 0;
      const key = `${day}|${model}`;
      const existing = map.get(key);
      if (existing) {
        existing.costUsd = (existing.costUsd ?? 0) + cost;
      } else {
        map.set(key, {
          provider: "openai",
          day,
          model,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: cost,
          requestCount: 0,
        });
      }
    }
  }

  return Array.from(map.values());
}

export function mergeOpenAIRows(
  usage: NormalizedUsageRow[],
  cost: NormalizedUsageRow[],
): NormalizedUsageRow[] {
  const map = new Map<string, NormalizedUsageRow>();
  for (const row of usage) {
    map.set(`${row.day}|${row.model}`, { ...row });
  }
  for (const row of cost) {
    const key = `${row.day}|${row.model}`;
    const existing = map.get(key);
    if (existing) {
      existing.costUsd = (existing.costUsd ?? 0) + (row.costUsd ?? 0);
    } else {
      map.set(key, { ...row });
    }
  }
  return Array.from(map.values());
}
