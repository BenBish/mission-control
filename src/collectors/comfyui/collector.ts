import type { Collector, TickResult } from "../core/types.js";
import type { IngestEvent, Sink } from "../../types/ingest.js";
import type { CollectorStateStore } from "../core/state-store.js";
import { sendBatched } from "../core/scheduler.js";
import { COMFYUI_POLL_INTERVAL_MS } from "./config.js";
import {
  fetchQueue,
  fetchHistoryEntry,
  buildPayloadFromQueue,
  buildPayloadFromHistory,
} from "./poller.js";

const SOURCE_ID = "comfyui";
const INSTANCE_ID = "comfyui@strix-halo";
const COLLECTOR_VERSION = "0.1.0";
const TRACKED_JOBS_KEY = "comfyui:tracked-jobs";

interface TrackedJob {
  firstSeenAt: string;
  lastEmittedStatus: string;
}

type TrackedJobs = Record<string, TrackedJob>;

/**
 * Poll-driven job tracking, not a push/webhook — ComfyUI's /queue only
 * shows what's currently queued/running, and /history only has a job
 * once it's terminal. A job's full lifecycle (queued -> running ->
 * success/error/interrupted) is reconstructed by diffing /queue against
 * locally-tracked state across ticks (survives a server restart via
 * CollectorStateStore, same pattern as Hermes's journal cursors).
 *
 * naturalKey includes the status (`comfyui:<promptId>:<status>`) so each
 * distinct transition gets its own dedupe-table row and actually lands —
 * upsertGenerationJob's ON CONFLICT merge means re-sending the same
 * status is harmless, but the generic ingest_dedupe check would otherwise
 * treat a repeat naturalKey as "already ingested" and silently drop a
 * real transition (e.g. running -> success) if the key didn't change.
 */
export class ComfyUiCollector implements Collector {
  sourceId = SOURCE_ID;
  instanceId = INSTANCE_ID;
  intervalMs = COMFYUI_POLL_INTERVAL_MS;

  constructor(private state: CollectorStateStore) {}

  async tick(sink: Sink): Promise<TickResult> {
    const queued = await fetchQueue();
    if (queued === null) {
      // ComfyUI isn't running — the expected default state (currently
      // disabled), not an error. No backoff, no error logging.
      return { eventsEmitted: 0, sourceStatus: "off" };
    }

    const tracked =
      this.state.getAggregate<TrackedJobs>(TRACKED_JOBS_KEY) ?? {};
    const events: IngestEvent[] = [];
    const nowIso = new Date().toISOString();
    const stillQueuedIds = new Set(queued.map((j) => j.promptId));

    for (const job of queued) {
      const existing = tracked[job.promptId];
      const firstSeenAt = existing?.firstSeenAt ?? nowIso;
      const status = job.state === "running" ? "running" : "queued";

      if (!existing || existing.lastEmittedStatus !== status) {
        const payload = buildPayloadFromQueue(job, firstSeenAt);
        events.push({
          kind: "generation_job",
          naturalKey: `comfyui:${job.promptId}:${status}`,
          payload,
        });
      }
      tracked[job.promptId] = { firstSeenAt, lastEmittedStatus: status };
    }

    // Jobs we were tracking that dropped out of /queue must have finished
    // (or ComfyUI restarted and lost them) — resolve via /history.
    for (const [promptId, info] of Object.entries(tracked)) {
      if (stillQueuedIds.has(promptId)) continue;
      if (
        info.lastEmittedStatus === "success" ||
        info.lastEmittedStatus === "error" ||
        info.lastEmittedStatus === "interrupted"
      ) {
        continue; // already resolved, nothing left to poll for
      }

      const entry = await fetchHistoryEntry(promptId);
      if (!entry) {
        // Not in history yet either — a brief gap between leaving the
        // queue and history being written. Leave tracked, retry next tick.
        continue;
      }
      const payload = buildPayloadFromHistory(
        promptId,
        entry,
        info.firstSeenAt,
      );
      events.push({
        kind: "generation_job",
        naturalKey: `comfyui:${promptId}:${payload.status}`,
        payload,
      });
      tracked[promptId] = {
        firstSeenAt: info.firstSeenAt,
        lastEmittedStatus: payload.status,
      };
    }

    // Drop fully-resolved jobs from the tracked set so it doesn't grow
    // unboundedly — nothing left to poll for once terminal.
    for (const [promptId, info] of Object.entries(tracked)) {
      if (
        info.lastEmittedStatus === "success" ||
        info.lastEmittedStatus === "error" ||
        info.lastEmittedStatus === "interrupted"
      ) {
        delete tracked[promptId];
      }
    }

    this.state.setAggregate(TRACKED_JOBS_KEY, tracked);

    if (events.length > 0) {
      await sendBatched(
        sink,
        SOURCE_ID,
        INSTANCE_ID,
        COLLECTOR_VERSION,
        events,
      );
    }
    this.state.persist();

    return { eventsEmitted: events.length, sourceStatus: "ok" };
  }
}

export function buildComfyUiCollectors(
  state: CollectorStateStore,
): Collector[] {
  return [new ComfyUiCollector(state)];
}
