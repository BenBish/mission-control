import { createHash } from "crypto";
import type { Collector, TickResult } from "../core/types.js";
import type {
  IngestEvent,
  Sink,
  RuntimeEventPayload,
} from "../../types/ingest.js";
import type { CollectorStateStore } from "../core/state-store.js";
import { sendBatched } from "../core/scheduler.js";
import { LEMONADE_POLL_INTERVAL_MS } from "./config.js";
import { pollHealth, pollSystemStats, pollStats } from "./poller.js";

const SOURCE_ID = "lemonade";
const INSTANCE_ID = "lemonade@strix-halo";
const COLLECTOR_VERSION = "0.1.0";
const HEALTH_STATE_KEY = "lemonade:health";

interface HealthState {
  lastKnownHealthy?: boolean;
}

function statKey(entry: { externalId?: string }, fallbackSeed: string): string {
  if (entry.externalId) return `lemonade:stat:${entry.externalId}`;
  return `lemonade:stat:${createHash("sha256").update(fallbackSeed).digest("hex").slice(0, 16)}`;
}

/**
 * UNVERIFIED against a live instance — see config.ts/poller.ts doc
 * comments. Built to the same shape as every other collector here
 * (Collector interface, health-transition state machine mirroring
 * llama-swap-collector.ts) so it's ready to flip on once someone can
 * actually test it, but every endpoint call may need correcting first.
 */
export class LemonadeCollector implements Collector {
  sourceId = SOURCE_ID;
  instanceId = INSTANCE_ID;
  intervalMs = LEMONADE_POLL_INTERVAL_MS;

  constructor(private state: CollectorStateStore) {}

  async tick(sink: Sink): Promise<TickResult> {
    const healthy = await pollHealth();
    const events: IngestEvent[] = [];

    const priorState =
      this.state.getAggregate<HealthState>(HEALTH_STATE_KEY) ?? {};
    if (
      priorState.lastKnownHealthy !== undefined &&
      priorState.lastKnownHealthy !== healthy
    ) {
      const event: RuntimeEventPayload = {
        timestamp: new Date().toISOString(),
        kind: healthy ? "service_up" : "service_down",
        severity: healthy ? "info" : "error",
        summary: healthy
          ? "Lemonade is back up"
          : "Lemonade health check failed",
      };
      events.push({
        kind: "runtime_event",
        naturalKey: `lemonade:health-transition:${event.timestamp}`,
        payload: event,
      });
    }
    this.state.setAggregate(HEALTH_STATE_KEY, { lastKnownHealthy: healthy });

    if (!healthy) {
      // Same as every other poller here: service-not-running is the
      // expected default state (Lemonade is currently disabled), not a
      // collector error.
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
      return { eventsEmitted: events.length, sourceStatus: "off" };
    }

    const systemSnapshot = await pollSystemStats();
    if (systemSnapshot) {
      events.push({
        kind: "runtime_snapshot",
        naturalKey: `lemonade:system:${systemSnapshot.timestamp}`,
        payload: systemSnapshot,
      });
    }

    const { requests, aggregateSnapshot } = await pollStats();
    for (const req of requests) {
      events.push({
        kind: "inference_request",
        naturalKey: statKey(req, JSON.stringify(req)),
        payload: req,
      });
    }
    if (aggregateSnapshot) {
      events.push({
        kind: "runtime_snapshot",
        naturalKey: `lemonade:stats-aggregate:${aggregateSnapshot.timestamp}`,
        payload: aggregateSnapshot,
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

    return { eventsEmitted: events.length, sourceStatus: "ok" };
  }
}

export function buildLemonadeCollectors(
  state: CollectorStateStore,
): Collector[] {
  return [new LemonadeCollector(state)];
}
