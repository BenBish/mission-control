/**
 * Cloud Handoff collector — polls the control plane's operator API for session
 * events and emits token usage.
 *
 * Workers report token usage in one of two shapes: `agent.usage` events
 * ({inputTokens, cachedInputTokens, outputTokens, costUsd?}) or, on the
 * Codex-style harness, `turn.completed` events carrying
 * usage:{input_tokens, cached_input_tokens, output_tokens, ...}. The
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
 *
 * Backfill: state written before `turn.completed` support has no
 * `turnUsageDrained` flag. Such a session gets one full-stream replay
 * (after=0) that counts every turn.completed usage (they were never
 * counted) while skipping already-watermarked agent.usage events, then the
 * flag is set so the replay runs exactly once — including for `done`
 * sessions, which are otherwise never re-polled.
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
  type CloudHandoffEvent,
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
  cacheWriteTokens: number;
  /** Undefined until an agent.usage event actually carries costUsd. */
  costUsd?: number;
  /** A `session` event has been emitted at least once. */
  emitted?: boolean;
  /** Terminal status reached and event stream drained — stop polling. */
  done?: boolean;
  /** Full-stream replay for turn.completed usage has run (backfill flag). */
  turnUsageDrained?: boolean;
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
    cacheWriteTokens: 0,
  };
}

function sessionPayload(
  session: CloudHandoffSession,
  agg: SessionAgg,
): IngestEvent {
  const terminal = TERMINAL_STATUSES.has(session.status);
  const naturalKey = `${session.id}:${session.status}:${agg.inputTokens}:${agg.outputTokens}:${agg.cacheReadTokens}:${agg.cacheWriteTokens}:${agg.costUsd ?? ""}`;
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
      cacheWriteTokens: agg.cacheWriteTokens,
      costUsd: agg.costUsd,
    },
  };
}

interface UsageTokens {
  input: number;
  output: number;
  cached: number;
  cacheWrite: number;
  cost?: number;
}

/**
 * Token usage carried by one control-plane event, in either vocabulary:
 *  - `agent.usage`   → payload.{inputTokens, cachedInputTokens, outputTokens, costUsd?}
 *  - `turn.completed`→ payload.usage.{input_tokens, cached_input_tokens,
 *                     output_tokens, cache_write_input_tokens}
 * Returns null for non-usage events and usage-less turn.completed frames.
 */
function eventUsage(ev: CloudHandoffEvent): UsageTokens | null {
  const p = ev.payload ?? {};
  if (ev.type === "agent.usage") {
    return {
      input: num(p.inputTokens) ?? 0,
      output: num(p.outputTokens) ?? 0,
      cached: num(p.cachedInputTokens) ?? 0,
      cacheWrite: num(p.cacheWriteTokens) ?? 0,
      cost: num(p.costUsd),
    };
  }
  if (ev.type === "turn.completed") {
    const usage = p.usage;
    if (!usage || typeof usage !== "object") return null;
    const u = usage as Record<string, unknown>;
    return {
      input: num(u.input_tokens) ?? 0,
      output: num(u.output_tokens) ?? 0,
      cached: num(u.cached_input_tokens) ?? 0,
      cacheWrite: num(u.cache_write_input_tokens) ?? 0,
    };
  }
  return null;
}

function usageActivity(
  session: CloudHandoffSession,
  ev: CloudHandoffEvent,
  tokens: UsageTokens,
): IngestEvent {
  return {
    kind: "activity",
    naturalKey: `usage:${session.id}:${ev.id}`,
    payload: {
      sessionExternalId: session.id,
      externalId: `${ev.type}:${ev.id}`,
      timestamp: ev.createdAt,
      actorType: "agent",
      actorId: session.agentExecutionSnapshot?.harness ?? SOURCE_ID,
      actionType: "event",
      description: "Cloud Handoff token usage",
      status: "success",
      model: session.agentExecutionSnapshot?.model,
      inputTokens: tokens.input,
      outputTokens: tokens.output,
      cacheReadTokens: tokens.cached,
      cacheWriteTokens: tokens.cacheWrite,
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
      // done + drained is terminal; done-but-undrained gets one backfill pass.
      if (prev.done && prev.turnUsageDrained) continue;
      // Spread over emptyAgg so counters added later (e.g. cacheWriteTokens)
      // default to 0 instead of turning NaN on legacy aggregates.
      const agg: SessionAgg = { ...emptyAgg(), ...prev };

      // State predating turn.completed support gets a full replay: those
      // events were consumed (watermark advanced) but never counted.
      const backfill = !agg.turnUsageDrained;
      const watermark = backfill ? 0 : agg.lastEventId;

      let sessionEvents;
      try {
        sessionEvents = await fetchSessionEvents(
          config,
          session.id,
          watermark,
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
        const alreadyCounted = ev.id <= prev.lastEventId;
        if (ev.id > agg.lastEventId) agg.lastEventId = ev.id;
        if (!alreadyCounted) consumed++;
        const usage = eventUsage(ev);
        if (!usage) continue;
        // Below the watermark, usage is countable only during the backfill
        // pass and only for turn.completed — the type the watermark advanced
        // past without counting. Everything else there is already folded in.
        if (alreadyCounted && !(backfill && ev.type === "turn.completed")) {
          continue;
        }
        agg.inputTokens += usage.input;
        agg.outputTokens += usage.output;
        agg.cacheReadTokens += usage.cached;
        agg.cacheWriteTokens += usage.cacheWrite;
        if (usage.cost != null) agg.costUsd = (agg.costUsd ?? 0) + usage.cost;
        sawUsage = true;
        events.push(usageActivity(session, ev, usage));
      }
      if (backfill) agg.turnUsageDrained = true;

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
      if (consumed > 0 || emittedSession || becameDone || backfill) {
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
