/**
 * Lemonade Server polling — UNVERIFIED, see config.ts's doc comment for
 * why. Endpoint paths/shapes below come from a prior research pass
 * (~/Dev/benbishop-context/docs/research/mission-control/...), which
 * characterized `/v1/stats` as "per-request TTFT/tok-per-sec/token
 * counts" — so this maps it to inference_request rows (matching Hermes's
 * shape) as the primary assumption, with a defensive fallback for a
 * single-aggregate-object response in case that characterization is
 * wrong. Every parse here is wrapped to degrade to "no data this tick"
 * rather than throw, since none of it has been checked against a real
 * response.
 */

import { LEMONADE_BASE_URL } from "./config.js";
import type {
  InferenceRequestPayload,
  RuntimeSnapshotPayload,
} from "../../types/ingest.js";

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${LEMONADE_BASE_URL}${path}`, {
      signal: AbortSignal.timeout(4_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function pollHealth(): Promise<boolean> {
  // UNVERIFIED path/shape — best guess is a 200 with some body on
  // success, matching the OpenAI-compatible convention every other
  // source here uses. If this turns out wrong, the poller just reports
  // "off" indefinitely rather than crashing, which is a safe failure
  // mode even if not a useful one.
  const result = await getJson<unknown>("/api/v1/health");
  return result !== null;
}

interface SystemStatsResponse {
  [key: string]: unknown;
}

export async function pollSystemStats(): Promise<RuntimeSnapshotPayload | null> {
  const stats = await getJson<SystemStatsResponse>("/api/v1/system-stats");
  if (!stats) return null;
  return {
    timestamp: new Date().toISOString(),
    kind: "system",
    healthy: true,
    payload: stats,
  };
}

/** UNVERIFIED shape. Best guess per prior research: an array of discrete
 *  per-request stat objects. Field names below (ttft_ms, tokens_per_sec,
 *  prompt_tokens, completion_tokens, model, id) are a guess at OpenAI/
 *  llama.cpp-adjacent naming conventions, not confirmed against a real
 *  response — treat every field as optional and don't fail the whole
 *  batch if some are missing or differently named. */
interface LemonadeStatEntry {
  id?: string;
  model?: string;
  ttft_ms?: number;
  tokens_per_sec?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  duration_ms?: number;
  status?: string;
  [key: string]: unknown;
}

export async function pollStats(): Promise<{
  requests: InferenceRequestPayload[];
  aggregateSnapshot: RuntimeSnapshotPayload | null;
}> {
  const raw = await getJson<LemonadeStatEntry[] | LemonadeStatEntry>(
    "/api/v1/stats",
  );
  if (!raw) return { requests: [], aggregateSnapshot: null };

  if (Array.isArray(raw)) {
    const now = new Date().toISOString();
    const requests: InferenceRequestPayload[] = raw.map((entry) => ({
      externalId: entry.id,
      timestamp: now,
      model: entry.model,
      clientLabel: "lemonade",
      workload: "unknown",
      promptTokens: entry.prompt_tokens,
      completionTokens: entry.completion_tokens,
      ttftMs: entry.ttft_ms,
      durationMs: entry.duration_ms,
      tokensPerSec: entry.tokens_per_sec,
      status: entry.status === "error" ? "error" : "success",
    }));
    return { requests, aggregateSnapshot: null };
  }

  // Single object — treat as an aggregate snapshot rather than a request.
  return {
    requests: [],
    aggregateSnapshot: {
      timestamp: new Date().toISOString(),
      kind: "system",
      healthy: true,
      payload: raw,
    },
  };
}
