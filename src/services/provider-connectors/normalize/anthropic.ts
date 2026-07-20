/**
 * Normalize Anthropic Admin Usage & Cost API responses.
 * @see https://platform.claude.com/docs/en/manage-claude/usage-cost-api
 */

import type { NormalizedUsageRow } from "../types.js";

interface UsageResult {
  model?: string | null;
  uncached_input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  output_tokens?: number;
  /** Some shapes nest tokens */
  input_tokens?: number;
}

interface UsageBucket {
  starting_at?: string;
  ending_at?: string;
  results?: UsageResult[];
}

interface UsageResponse {
  data?: UsageBucket[];
}

interface CostResult {
  amount?: string | number | { value?: string | number; currency?: string };
  description?: string | null;
  model?: string | null;
  currency?: string;
}

interface CostBucket {
  starting_at?: string;
  ending_at?: string;
  results?: CostResult[];
}

interface CostResponse {
  data?: CostBucket[];
}

function dayFromIso(iso: string | undefined): string | null {
  if (!iso || typeof iso !== "string") return null;
  // starting_at is inclusive start of bucket (UTC)
  return iso.slice(0, 10);
}

/**
 * Anthropic cost `amount` is in lowest currency units (cents), including
 * fractional cents as decimal strings (e.g. "123.45" → $1.2345).
 * Object form `{ value }` is treated as dollars (OpenAI-style compatibility).
 */
function parseCostUsd(amount: CostResult["amount"]): number {
  if (amount == null) return 0;
  if (typeof amount === "object" && amount !== null && "value" in amount) {
    const v = Number(amount.value);
    return Number.isFinite(v) ? v : 0;
  }
  const n = Number(amount);
  if (!Number.isFinite(n)) return 0;
  return n / 100;
}

/**
 * Map usage_report/messages buckets (group_by=model) into normalized rows.
 * Cost is left null here and merged from cost_report when available.
 */
export function normalizeAnthropicUsage(
  payload: unknown,
): NormalizedUsageRow[] {
  const body = payload as UsageResponse;
  const buckets = Array.isArray(body?.data) ? body.data : [];
  const map = new Map<string, NormalizedUsageRow>();

  for (const bucket of buckets) {
    const day = dayFromIso(bucket.starting_at);
    if (!day) continue;
    for (const r of bucket.results ?? []) {
      const model =
        typeof r.model === "string" && r.model.trim()
          ? r.model.trim()
          : "unknown";
      const input =
        (Number(r.uncached_input_tokens) || 0) +
        (Number(r.cache_read_input_tokens) || 0) +
        (Number(r.cache_creation_input_tokens) || 0) +
        (Number(r.input_tokens) || 0);
      const output = Number(r.output_tokens) || 0;
      const key = `${day}|${model}`;
      const existing = map.get(key);
      if (existing) {
        existing.inputTokens += input;
        existing.outputTokens += output;
      } else {
        map.set(key, {
          provider: "anthropic",
          day,
          model,
          inputTokens: input,
          outputTokens: output,
          costUsd: null,
          requestCount: 0,
        });
      }
    }
  }

  return Array.from(map.values());
}

/**
 * Map cost_report buckets into per-day cost rows (model from description when present).
 */
export function normalizeAnthropicCost(payload: unknown): NormalizedUsageRow[] {
  const body = payload as CostResponse;
  const buckets = Array.isArray(body?.data) ? body.data : [];
  const map = new Map<string, NormalizedUsageRow>();

  for (const bucket of buckets) {
    const day = dayFromIso(bucket.starting_at);
    if (!day) continue;
    for (const r of bucket.results ?? []) {
      const model =
        (typeof r.model === "string" && r.model.trim()
          ? r.model.trim()
          : null) ||
        (typeof r.description === "string" && r.description.trim()
          ? r.description.trim()
          : "unknown");
      const cost = parseCostUsd(r.amount);
      const key = `${day}|${model}`;
      const existing = map.get(key);
      if (existing) {
        existing.costUsd = (existing.costUsd ?? 0) + cost;
      } else {
        map.set(key, {
          provider: "anthropic",
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

/** Merge usage + cost rows by (day, model). */
export function mergeAnthropicRows(
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
