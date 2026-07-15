import type { Collector, TickResult } from "../core/types.js";
import type { IngestEvent, Sink } from "../../types/ingest.js";
import type { CollectorStateStore } from "../core/state-store.js";
import { sendBatched } from "../core/scheduler.js";
import { POLL_INTERVAL_MS, type HermesBackend } from "./config.js";
import {
  pollSlots,
  updateSaturation,
  emptySaturationState,
  type SaturationState,
} from "./llama-server-poller.js";
import {
  HermesLogParser,
  failureRuntimeEvent,
  type LogParserState,
} from "./log-parser.js";
import { anyGatewayCompressionActivity } from "./workload-correlation.js";
import type { InferenceRequestPayload } from "../../types/ingest.js";

const SOURCE_ID = "hermes";
const INSTANCE_ID = "hermes@strix-halo";
const COLLECTOR_VERSION = "0.1.0";

/**
 * One collector per llama-server backend (12345/12346/12347) — combines
 * /slots occupancy polling (live snapshot + saturation-episode detection)
 * with journal-based per-request telemetry (log-parser.ts). Both target
 * the same backend on the same interval, so one Collector per port is a
 * natural grouping rather than splitting into two collectors that would
 * just double the bookkeeping.
 */
export class HermesBackendCollector implements Collector {
  sourceId = SOURCE_ID;
  instanceId = INSTANCE_ID;
  intervalMs = POLL_INTERVAL_MS;

  private logParser: HermesLogParser;
  private saturationKey: string;
  private cursorKey: string;

  constructor(
    private backend: HermesBackend,
    private state: CollectorStateStore,
  ) {
    this.logParser = new HermesLogParser(backend);
    this.saturationKey = `hermes:saturation:${backend.port}`;
    this.cursorKey = `hermes:log-cursor:${backend.unit}`;
  }

  async tick(sink: Sink): Promise<TickResult> {
    const events: IngestEvent[] = [];

    const slotResult = await pollSlots(this.backend);
    if (!slotResult.reachable) {
      // A specific backend being unreachable is data (surfaced by the
      // Runtime page as "no recent snapshot for this backend"), not a
      // collector failure — and since all 4 Hermes collectors
      // (llama-swap + 3 backends) share the single hermes@strix-halo
      // instanceId, each independently calls heartbeat() every tick, so
      // reporting anything other than 'ok' here would make
      // source_instances.status flap between collectors' differing views
      // instead of reflecting whether the Hermes poller itself is
      // operating. llama-swap's own health polling is the intended
      // signal for "something's actually wrong" (service_down).
      return {
        eventsEmitted: 0,
        sourceStatus: "ok",
        detail: `${this.backend.label} (port ${this.backend.port}) unreachable`,
      };
    }

    if (slotResult.snapshot) {
      events.push({
        kind: "runtime_snapshot",
        naturalKey: `${this.backend.unit}:slots:${slotResult.snapshot.timestamp}`,
        payload: slotResult.snapshot,
      });
    }

    const saturationState =
      this.state.getAggregate<SaturationState>(this.saturationKey) ??
      emptySaturationState();
    const saturation = updateSaturation(
      this.backend,
      slotResult,
      saturationState,
    );
    this.state.setAggregate(this.saturationKey, saturation.state);
    if (saturation.event) {
      events.push({
        kind: "runtime_event",
        naturalKey: `${this.backend.unit}:saturation:${saturation.event.timestamp}`,
        payload: saturation.event,
      });
    }

    const logState =
      this.state.getAggregate<LogParserState>(this.cursorKey) ?? {};
    const logResult = await this.logParser.tick(logState);

    // Best-effort workload:'background' tagging — see
    // workload-correlation.ts's doc comment for why this only applies to
    // the backend all Hermes gateways share, and why it's coarse
    // (tick-window, not per-request). One journalctl scan per tick, only
    // when this tick actually closed a request on that backend.
    if (this.backend.sharedByGateways && logResult.events.length > 0) {
      const timestamps = logResult.events
        .map((e) => (e.payload as InferenceRequestPayload).timestamp)
        .filter((t): t is string => Boolean(t));
      if (timestamps.length > 0) {
        const windowStart = timestamps.reduce((a, b) => (a < b ? a : b));
        const windowEnd = new Date().toISOString();
        const backgroundLikely = await anyGatewayCompressionActivity(
          windowStart,
          windowEnd,
        ).catch(() => false);
        if (backgroundLikely) {
          for (const event of logResult.events) {
            if (event.kind === "inference_request") {
              (event.payload as InferenceRequestPayload).workload =
                "background";
            }
          }
        }
      }
    }

    for (const event of logResult.events) {
      events.push(event);
      const failureEvent = failureRuntimeEvent(this.backend, event);
      if (failureEvent) events.push(failureEvent);
    }
    // Persist the new cursor regardless of send outcome below being awaited
    // first — see note at the bottom of this method for why this ordering
    // is safe here (unlike the JSONL collectors' cursor-after-ACK rule).
    const newLogState: LogParserState = { cursor: logResult.cursor };

    if (events.length > 0) {
      await sendBatched(
        sink,
        SOURCE_ID,
        INSTANCE_ID,
        COLLECTOR_VERSION,
        events,
      );
    }

    // Unlike the JSONL collectors (where re-reading the same file bytes on
    // a retry is cheap and safe), persist the journal cursor and
    // saturation state unconditionally after building this tick's events,
    // not only after a successful send. A failed send here just means
    // this tick's rows won't be retried — acceptable for point-in-time
    // telemetry (a missed slots snapshot or one dropped inference_request
    // row isn't the kind of data loss JSONL replay exists to prevent),
    // and the alternative (re-reading the same journal cursor range next
    // tick) would double-count nothing since dedupe still catches exact
    // naturalKey repeats, but WOULD re-run the multi-line task-buffering
    // logic from a stale open-task state that's already been discarded in
    // memory, producing corrupt half-built rows.
    this.state.setAggregate(this.cursorKey, newLogState);
    this.state.persist();

    return { eventsEmitted: events.length, sourceStatus: "ok" };
  }
}
