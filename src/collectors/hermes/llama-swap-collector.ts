import type { Collector, TickResult } from "../core/types.js";
import type { IngestEvent, Sink } from "../../types/ingest.js";
import type { CollectorStateStore } from "../core/state-store.js";
import { sendBatched } from "../core/scheduler.js";
import { POLL_INTERVAL_MS } from "./config.js";
import {
  pollLlamaSwapHealth,
  updateHealthState,
  type LlamaSwapHealthState,
} from "./llama-swap-poller.js";

const SOURCE_ID = "hermes";
const INSTANCE_ID = "hermes@strix-halo";
const COLLECTOR_VERSION = "0.1.0";
const HEALTH_STATE_KEY = "hermes:health:llama-swap";

export class LlamaSwapCollector implements Collector {
  sourceId = SOURCE_ID;
  instanceId = INSTANCE_ID;
  intervalMs = POLL_INTERVAL_MS;

  constructor(private state: CollectorStateStore) {}

  async tick(sink: Sink): Promise<TickResult> {
    const result = await pollLlamaSwapHealth();
    const events: IngestEvent[] = [];

    if (result.snapshot) {
      events.push({
        kind: "runtime_snapshot",
        naturalKey: `llama-swap:health:${result.snapshot.timestamp}`,
        payload: result.snapshot,
      });
    }

    const priorState =
      this.state.getAggregate<LlamaSwapHealthState>(HEALTH_STATE_KEY) ?? {};
    const { state: newState, event } = updateHealthState(result, priorState);
    this.state.setAggregate(HEALTH_STATE_KEY, newState);
    if (event) {
      events.push({
        kind: "runtime_event",
        naturalKey: `llama-swap:health-transition:${event.timestamp}`,
        payload: event,
      });
    }

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

    // llama-swap being down is data the collector successfully recorded
    // (a service_down runtime_event, above), not a collector failure —
    // sourceStatus stays 'ok' either way so the scheduler keeps polling
    // on its normal 5s interval rather than backing off during an actual
    // outage, which is exactly when fast recovery detection matters most.
    // A genuine collector-side failure (network stack error, DB write
    // failure) already throws and is caught by the scheduler itself.
    return { eventsEmitted: events.length, sourceStatus: "ok" };
  }
}
