/**
 * ComfyUI job telemetry — /queue and /history/:promptId. Verified live
 * against the real box (2026-07-13): submitted two real workflows (a
 * 1-step SDXL Turbo job and an 8-step one) and captured their exact
 * /queue and /history shapes. Only ever observed status_str: "success" —
 * the error/interrupted paths below are best-effort, not independently
 * confirmed (see deriveStatus's doc comment).
 */

import { createHash } from "crypto";
import { COMFYUI_URL } from "./config.js";
import type {
  GenerationJobPayload,
  GenerationJobStatus,
} from "../../types/ingest.js";

// ─── Raw response shapes ────────────────────────────────────────────────────

/** [queue_number, prompt_id, prompt_dict, {create_time}, [output_node_id, ...]] */
type QueueTuple = [
  number,
  string,
  Record<string, { class_type: string; inputs?: Record<string, unknown> }>,
  { create_time?: number },
  string[],
];

interface QueueResponse {
  queue_running: QueueTuple[];
  queue_pending: QueueTuple[];
}

interface HistoryStatusMessage {
  0: string; // event name, e.g. "execution_start" | "execution_success" | "execution_error"
  1: {
    prompt_id?: string;
    timestamp?: number;
    nodes?: string[];
    [k: string]: unknown;
  };
}

interface HistoryEntry {
  prompt: QueueTuple;
  outputs?: Record<
    string,
    { images?: Array<{ filename: string; subfolder: string; type: string }> }
  >;
  status: {
    status_str: string;
    completed: boolean;
    messages: HistoryStatusMessage[];
  };
  meta?: unknown;
}

type HistoryResponse = Record<string, HistoryEntry>;

export interface QueuedJob {
  promptId: string;
  prompt: QueueTuple[2];
  state: "running" | "pending";
}

// ─── HTTP ────────────────────────────────────────────────────────────────

export async function fetchQueue(): Promise<QueuedJob[] | null> {
  try {
    const res = await fetch(`${COMFYUI_URL}/queue`, {
      signal: AbortSignal.timeout(4_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as QueueResponse;
    const running = (data.queue_running ?? []).map(
      (t): QueuedJob => ({ promptId: t[1], prompt: t[2], state: "running" }),
    );
    const pending = (data.queue_pending ?? []).map(
      (t): QueuedJob => ({ promptId: t[1], prompt: t[2], state: "pending" }),
    );
    return [...running, ...pending];
  } catch {
    return null;
  }
}

/** Always target a specific prompt_id — the bare /history (no id) returns
 *  every job ComfyUI has ever run and grows unbounded, never poll it. */
export async function fetchHistoryEntry(
  promptId: string,
): Promise<HistoryEntry | null> {
  try {
    const res = await fetch(`${COMFYUI_URL}/history/${promptId}`, {
      signal: AbortSignal.timeout(4_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as HistoryResponse;
    return data[promptId] ?? null;
  } catch {
    return null;
  }
}

// ─── Pure derivation (unit-testable without a live server) ────────────────

export function nodeCount(prompt: QueueTuple[2]): number {
  return Object.keys(prompt).length;
}

export function outputCount(outputs: HistoryEntry["outputs"]): number {
  if (!outputs) return 0;
  let count = 0;
  for (const node of Object.values(outputs)) {
    count += node.images?.length ?? 0;
  }
  return count;
}

/** Not provided by ComfyUI — synthesized here so visually-identical
 *  workflows can be grouped later. Stable across runs of the same graph
 *  (same node structure + inputs), not a ComfyUI-native concept. */
export function workflowHash(prompt: QueueTuple[2]): string {
  return createHash("sha256")
    .update(JSON.stringify(prompt))
    .digest("hex")
    .slice(0, 16);
}

function msToIso(ms: number | undefined): string | undefined {
  return ms == null ? undefined : new Date(ms).toISOString();
}

/**
 * Maps a history entry's status.messages to our GenerationJobStatus union.
 * Confirmed live: "execution_start" and "execution_success" both appear
 * with {prompt_id, timestamp} on real successful jobs — that's the only
 * path independently verified. The failure path below (status_str other
 * than "success", or an "execution_error" message) is a best-effort
 * guess at ComfyUI's actual failure shape, not confirmed against a real
 * failure — deliberately defensive: anything unrecognized maps to
 * 'error' with the raw status_str preserved in details rather than
 * crashing or silently dropping the job.
 */
export function deriveStatus(entry: HistoryEntry): {
  status: GenerationJobStatus;
  observedStartedAt?: string;
  observedCompletedAt?: string;
} {
  const startMsg = entry.status.messages.find(
    (m) => m[0] === "execution_start",
  );
  const successMsg = entry.status.messages.find(
    (m) => m[0] === "execution_success",
  );
  const errorMsg = entry.status.messages.find(
    (m) => m[0] === "execution_error" || m[0] === "execution_interrupted",
  );

  const observedStartedAt = msToIso(startMsg?.[1]?.timestamp);

  if (entry.status.status_str === "success" && successMsg) {
    return {
      status: "success",
      observedStartedAt,
      observedCompletedAt: msToIso(successMsg[1]?.timestamp),
    };
  }
  if (errorMsg?.[0] === "execution_interrupted") {
    return {
      status: "interrupted",
      observedStartedAt,
      observedCompletedAt: msToIso(errorMsg[1]?.timestamp),
    };
  }
  // Anything else (status_str: "error", an unrecognized value, or
  // completed:true with no success message) — treat as a failure rather
  // than guessing further. The raw status_str/messages are preserved by
  // the caller in `details` for debugging.
  return {
    status: "error",
    observedStartedAt,
    observedCompletedAt: msToIso(errorMsg?.[1]?.timestamp),
  };
}

export function buildPayloadFromHistory(
  promptId: string,
  entry: HistoryEntry,
  firstSeenAt: string,
): GenerationJobPayload {
  const { status, observedStartedAt, observedCompletedAt } =
    deriveStatus(entry);
  return {
    externalId: promptId,
    status,
    firstSeenAt,
    observedStartedAt,
    observedCompletedAt,
    workflowHash: workflowHash(entry.prompt[2]),
    nodeCount: nodeCount(entry.prompt[2]),
    outputCount: outputCount(entry.outputs),
    details: {
      statusStr: entry.status.status_str,
      messages: entry.status.messages,
    },
  };
}

export function buildPayloadFromQueue(
  job: QueuedJob,
  firstSeenAt: string,
): GenerationJobPayload {
  return {
    externalId: job.promptId,
    status: job.state === "running" ? "running" : "queued",
    firstSeenAt,
    workflowHash: workflowHash(job.prompt),
    nodeCount: nodeCount(job.prompt),
  };
}
