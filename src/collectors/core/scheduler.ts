import type { Collector, TickResult } from "./types.js";
import type { IngestEvent, Sink } from "../../types/ingest.js";

const BACKOFF_INITIAL_MS = 2_000;
const BACKOFF_MAX_MS = 5 * 60_000;
const BATCH_CHUNK_SIZE = 500;

/**
 * Send events in chunks so a single huge backlog-drain tick doesn't produce
 * one oversized request. Collectors call this from inside their own tick()
 * — the Collector interface hands them the sink directly rather than the
 * scheduler collecting events and sending on their behalf, so each
 * collector controls exactly when its cursor is safe to persist (only
 * after every chunk it depends on has been ACKed).
 */
export async function sendBatched(
  sink: Sink,
  sourceId: string,
  instanceId: string,
  collectorVersion: string,
  events: IngestEvent[],
): Promise<void> {
  for (let i = 0; i < events.length; i += BATCH_CHUNK_SIZE) {
    const chunk = events.slice(i, i + BATCH_CHUNK_SIZE);
    await sink.send({
      sourceId,
      instanceId,
      collectorVersion,
      sentAt: new Date().toISOString(),
      events: chunk,
    });
  }
}

interface ScheduledEntry {
  collector: Collector;
  timer: ReturnType<typeof setTimeout> | null;
  backoffMs: number;
}

/**
 * Runs a set of Collectors on their own interval timers. On failure
 * (tick() throws, or reports sourceStatus 'error'), backs off
 * exponentially (2s -> 5min) for that collector only — other collectors
 * keep their own schedule. sourceStatus 'off' (a disabled source, e.g.
 * Lemonade/ComfyUI today) is a normal quiet state, not a failure — no
 * backoff, no error logging.
 */
export class Scheduler {
  private entries: ScheduledEntry[];
  private stopped = true;

  constructor(
    collectors: Collector[],
    private sink: Sink,
  ) {
    this.entries = collectors.map((collector) => ({
      collector,
      timer: null,
      backoffMs: BACKOFF_INITIAL_MS,
    }));
  }

  start(): void {
    this.stopped = false;
    for (const entry of this.entries) {
      this.runNow(entry);
    }
  }

  stop(): void {
    this.stopped = true;
    for (const entry of this.entries) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = null;
    }
  }

  private runNow(entry: ScheduledEntry): void {
    void this.runOnce(entry);
  }

  private async runOnce(entry: ScheduledEntry): Promise<void> {
    if (this.stopped) return;
    const { collector } = entry;
    let result: TickResult;
    let tickFailed = false;

    try {
      result = await collector.tick(this.sink);
    } catch (err) {
      tickFailed = true;
      result = {
        eventsEmitted: 0,
        sourceStatus: "error",
        detail: err instanceof Error ? err.message : String(err),
      };
      console.error(
        `[scheduler] ${collector.sourceId}/${collector.instanceId} tick failed: ${result.detail}`,
      );
    }

    let heartbeatFailed = false;
    try {
      await this.sink.heartbeat({
        sourceId: collector.sourceId,
        instanceId: collector.instanceId,
        status: result.sourceStatus,
        detail: result.detail,
        eventsEmitted: result.eventsEmitted,
      });
    } catch (err) {
      heartbeatFailed = true;
      console.error(
        `[scheduler] ${collector.sourceId}/${collector.instanceId} heartbeat failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    const isFailure =
      tickFailed || heartbeatFailed || result.sourceStatus === "error";
    entry.backoffMs = isFailure
      ? Math.min(entry.backoffMs * 2, BACKOFF_MAX_MS)
      : BACKOFF_INITIAL_MS;

    const delay = isFailure ? entry.backoffMs : collector.intervalMs;
    if (!this.stopped) {
      entry.timer = setTimeout(() => this.runNow(entry), delay);
    }
  }
}
