/**
 * Cloud Handoff collector — polls the control plane's operator API for session
 * events and emits token usage.
 *
 * Each worker reports `agent.usage` events ({inputTokens, cachedInputTokens,
 * outputTokens, costUsd?}) over POST /internal/sessions/:id/events; the
 * collector replays them via GET /v1/sessions/:id/events?after=<id> and maps
 * each one to an `activity` ingest event (the consumption view reads tokens
 * from activities). A cumulative `session` event keeps the sessions row's
 * totals current — upsertSession MAX-merges, and the naturalKey embeds the
 * totals so re-emitted identical payloads dedupe while real growth upserts.
 *
 * Per-session state (last event id + running totals + drained flag) lives in
 * the shared CollectorStateStore so restarts don't replay or undercount.
 * Aggregates are only written after the batch is ACKed, so a failed send just
 * refetches from the old cursor — server-side dedupe absorbs the replay.
 */

import os from "os";
import type { Collector, TickResult } from "../core/types.js";
import type { IngestEvent, Sink } from "../../types/ingest.js";
import { CollectorStateStore } from "../core/state-store.js";
import { sendBatched } from "../core/scheduler.js";
import {
  DEFAULT_CLOUD_HANDOFF_CONFIG_PATH,
  readCloudHandoffConfig,
} from "./config.js";
import {
  fetchSessionEvents,
  fetchSessions,
  type CloudHandoffSession,
} from "./client.js";

const SOURCE_ID = "cloud-handoff";
const COLLECTOR_VERSION = "0.1.0";
const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

type FetchImpl = typeof fetch;

interface SessionAgg {
  /** Highest control-plane event id consumed for this session. */
  lastEventId: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  /** Undefined until an agent.usage event actually carries costUsd. */
  costUsd?: number;
  /** A `session` event has been emitted at least once. */
  emitted?: boolean;
  /** Terminal status reached and event stream drained — stop polling. */
  done?: boolean;
}

interface StateStore {
  getAggregate: CollectorStateStore["getAggregate"];
  setAggregate: CollectorStateStore["setAggregate"];
  persist: CollectorStateStore["persist"];
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function emptyAgg(): SessionAgg {
  return {
    lastEventId: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
  };
}

function sessionPayload(
  session: CloudHandoffSession,
  agg: SessionAgg,
): IngestEvent {
  const terminal = TERMINAL_STATUSES.has(session.status);
  const naturalKey = `${session.id}:${session.status}:${agg.inputTokens}:${agg.outputTokens}:${agg.cacheReadTokens}:${agg.costUsd ?? ""}`;
  return {
    kind: "session",
    naturalKey,
    payload: {
      externalId: session.id,
      title: session.task || undefined,
      gitBranch: session.branch,
      modelProvider:
        session.agentExecutionSnapshot?.provider ??
        session.agentExecutionSnapshot?.harness,
      startedAt: session.createdAt,
      endedAt: terminal ? session.updatedAt : undefined,
      inputTokens: agg.inputTokens,
      outputTokens: agg.outputTokens,
      cacheReadTokens: agg.cacheReadTokens,
      costUsd: agg.costUsd,
    },
  };
}

function usageActivity(
  session: CloudHandoffSession,
  eventId: number,
  createdAt: string,
  tokens: { input: number; output: number; cached: number; cost?: number },
): IngestEvent {
  return {
    kind: "activity",
    naturalKey: `usage:${session.id}:${eventId}`,
    payload: {
      sessionExternalId: session.id,
      externalId: `agent.usage:${eventId}`,
      timestamp: createdAt,
      actorType: "agent",
      actorId: session.agentExecutionSnapshot?.harness ?? SOURCE_ID,
      actionType: "event",
      description: "Cloud Handoff token usage",
      status: "success",
      model: session.agentExecutionSnapshot?.model,
      inputTokens: tokens.input,
      outputTokens: tokens.output,
      cacheReadTokens: tokens.cached,
      costUsd: tokens.cost,
    },
  };
}

export class CloudHandoffCollector implements Collector {
  sourceId = SOURCE_ID;
  instanceId = `${SOURCE_ID}@${os.hostname()}`;
  intervalMs = 60_000;

  constructor(
    private state: StateStore,
    private configPath: string = DEFAULT_CLOUD_HANDOFF_CONFIG_PATH,
    private fetchImpl: FetchImpl = fetch,
  ) {}

  async tick(sink: Sink): Promise<TickResult> {
    const config = readCloudHandoffConfig(this.configPath);
    if (!config) {
      return {
        eventsEmitted: 0,
        sourceStatus: "off",
        detail:
          "not configured — run `handoff setup` or set CLOUD_HANDOFF_URL/CLOUD_HANDOFF_TOKEN",
      };
    }

    let sessions: CloudHandoffSession[];
    try {
      sessions = await fetchSessions(config, this.fetchImpl);
    } catch (err) {
      return {
        eventsEmitted: 0,
        sourceStatus: "error",
        detail: `sessions fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const events: IngestEvent[] = [];
    const pendingAggs = new Map<string, SessionAgg>();
    let fetchFailures = 0;

    for (const session of sessions) {
      const aggKey = `${SOURCE_ID}:${session.id}`;
      const prev = this.state.getAggregate<SessionAgg>(aggKey) ?? emptyAgg();
      if (prev.done) continue;
      const agg: SessionAgg = { ...prev };

      let sessionEvents;
      try {
        sessionEvents = await fetchSessionEvents(
          config,
          session.id,
          agg.lastEventId,
          this.fetchImpl,
        );
      } catch (err) {
        fetchFailures++;
        console.warn(
          `[cloud-handoff] events fetch failed for ${session.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
        continue;
      }

      let sawUsage = false;
      let consumed = 0;
      for (const ev of sessionEvents) {
        // The server filters on `after`, but guard anyway so a replayed stream
        // can never double-count.
        if (ev.id <= agg.lastEventId) continue;
        agg.lastEventId = ev.id;
        consumed++;
        if (ev.type !== "agent.usage") continue;
        const p = ev.payload ?? {};
        const input = num(p.inputTokens) ?? 0;
        const output = num(p.outputTokens) ?? 0;
        const cached = num(p.cachedInputTokens) ?? 0;
        const cost = num(p.costUsd);
        agg.inputTokens += input;
        agg.outputTokens += output;
        agg.cacheReadTokens += cached;
        if (cost != null) agg.costUsd = (agg.costUsd ?? 0) + cost;
        sawUsage = true;

        events.push(
          usageActivity(session, ev.id, ev.createdAt, {
            input,
            output,
            cached,
            cost,
          }),
        );
      }

      const becameDone = TERMINAL_STATUSES.has(session.status);
      let emittedSession = false;
      if (!agg.emitted || sawUsage || becameDone) {
        events.push(sessionPayload(session, agg));
        agg.emitted = true;
        emittedSession = true;
      }
      if (becameDone) agg.done = true;
      // Only persist aggs that actually changed — a running session with no new
      // events leaves its record untouched and shouldn't rewrite the state file.
      if (consumed > 0 || emittedSession || becameDone) {
        pendingAggs.set(aggKey, agg);
      }
    }

    if (events.length > 0) {
      await sendBatched(
        sink,
        SOURCE_ID,
        this.instanceId,
        COLLECTOR_VERSION,
        events,
      );
    }
    for (const [key, agg] of pendingAggs) {
      this.state.setAggregate(key, agg);
    }
    if (pendingAggs.size > 0) this.state.persist();

    if (fetchFailures > 0) {
      return {
        eventsEmitted: events.length,
        sourceStatus: "error",
        detail: `events fetch failed for ${fetchFailures} session(s)`,
      };
    }
    return { eventsEmitted: events.length, sourceStatus: "ok" };
  }
}
