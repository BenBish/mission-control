/**
 * llama-swap (router) health/model-inventory polling — /health, /running,
 * /v1/models. Verified live: /metrics returns 404 on this build (don't
 * rely on it), /running only lists models it currently considers "warm"
 * (not every backend that's actually alive — cross-checked against `ps
 * aux` on the real box, where all 3 backends were alive but /running
 * only showed one), /v1/models is a static config-derived inventory
 * that's a better "what models exist" source even when idle.
 */

import type {
  RuntimeEventPayload,
  RuntimeSnapshotPayload,
} from "../../types/ingest.js";
import { LLAMA_SWAP_URL } from "./config.js";

interface RunningModel {
  model: string;
  name?: string;
  proxy?: string;
  state?: string;
}

interface ModelInfo {
  id: string;
  name?: string;
  meta?: { llamaswap?: Record<string, unknown> };
}

export interface HealthPollResult {
  healthy: boolean;
  running?: RunningModel[];
  models?: ModelInfo[];
  snapshot?: RuntimeSnapshotPayload;
}

export async function pollLlamaSwapHealth(): Promise<HealthPollResult> {
  try {
    const healthRes = await fetch(`${LLAMA_SWAP_URL}/health`, {
      signal: AbortSignal.timeout(4_000),
    });
    if (!healthRes.ok) return { healthy: false };

    const [runningRes, modelsRes] = await Promise.all([
      fetch(`${LLAMA_SWAP_URL}/running`, {
        signal: AbortSignal.timeout(4_000),
      }).catch(() => null),
      fetch(`${LLAMA_SWAP_URL}/v1/models`, {
        signal: AbortSignal.timeout(4_000),
      }).catch(() => null),
    ]);

    const running = runningRes?.ok
      ? ((await runningRes.json()) as { running?: RunningModel[] }).running
      : undefined;
    const models = modelsRes?.ok
      ? ((await modelsRes.json()) as { data?: ModelInfo[] }).data
      : undefined;

    return {
      healthy: true,
      running,
      models,
      snapshot: {
        timestamp: new Date().toISOString(),
        kind: "models",
        healthy: true,
        modelsLoaded: running,
        payload: { models },
      },
    };
  } catch {
    return { healthy: false };
  }
}

export interface LlamaSwapHealthState {
  lastKnownHealthy?: boolean;
}

/** Only emits service_down/service_up on an actual transition, not every
 *  tick — matches the plan's "kill llama-swap -> service_down runtime_event
 *  + red health card" verification target. */
export function updateHealthState(
  result: HealthPollResult,
  state: LlamaSwapHealthState,
): { state: LlamaSwapHealthState; event?: RuntimeEventPayload } {
  const now = new Date().toISOString();
  if (state.lastKnownHealthy === undefined) {
    // First observation — record it, don't emit a transition event (we
    // don't know the prior state, so "startup was already down" isn't a
    // transition worth alarming on).
    return { state: { lastKnownHealthy: result.healthy } };
  }
  if (state.lastKnownHealthy === result.healthy) {
    return { state };
  }
  return {
    state: { lastKnownHealthy: result.healthy },
    event: {
      timestamp: now,
      kind: result.healthy ? "service_up" : "service_down",
      severity: result.healthy ? "info" : "error",
      summary: result.healthy
        ? "llama-swap is back up"
        : "llama-swap health check failed",
    },
  };
}
