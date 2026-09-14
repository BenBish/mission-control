import { glob } from "glob";
import os from "os";
import type { Collector, TickResult } from "../core/types.js";
import type { ActivityPayload, IngestEvent, Sink } from "../../types/ingest.js";
import { scanJsonlFile } from "../core/jsonl-scanner.js";
import { CollectorStateStore } from "../core/state-store.js";
import { sendBatched } from "../core/scheduler.js";
import {
  aggregateToSessionPayload,
  emptyAggregate,
  mergeSessionUpdate,
  parseClaudeCodeLine,
  type ClaudeCodeSessionAggregate,
  type ParsedLine,
} from "./parser.js";
import {
  CLAUDE_USAGE_POLL_INTERVAL_MS,
  DEFAULT_CLAUDE_CREDENTIALS_PATH,
  pollClaudeUsageEvents,
} from "./usage-poller.js";
import { OtelReceiver, type OtelReceiverLike } from "./otel-receiver.js";

const SOURCE_ID = "claude-code";
const INSTANCE_ID = "claude-code@arch-desktop";
const DEFAULT_GLOB = `${os.homedir()}/.claude/projects/**/*.jsonl`;
const COLLECTOR_VERSION = "0.1.0";

export class ClaudeCodeCollector implements Collector {
  sourceId = SOURCE_ID;
  instanceId = INSTANCE_ID;
  intervalMs = 30_000;

  /** Last successful-or-attempted OAuth usage poll (ms epoch). */
  private lastUsagePollMs = 0;
  /** Set once the OTLP receiver's first start attempt (success or failure) resolves. */
  private otelStartAttempted = false;

  constructor(
    private state: CollectorStateStore,
    private filesGlob: string = DEFAULT_GLOB,
    private credentialsPath: string = DEFAULT_CLAUDE_CREDENTIALS_PATH,
    private otelReceiver: OtelReceiverLike = new OtelReceiver(),
  ) {}

  async tick(sink: Sink): Promise<TickResult> {
    if (!this.otelStartAttempted) {
      this.otelStartAttempted = true;
      // Opt-in and additive: if this never binds (port in use, etc.) the
      // collector's JSONL-only behavior below is completely unaffected —
      // start() never throws, it just logs and leaves cost data absent.
      await this.otelReceiver.start();
    }

    const events: IngestEvent[] = [];
    // externalId -> updates seen this tick (merged into the persisted aggregate
    // only after a successful send, so a failed batch can be retried safely).
    const pendingAggregateUpdates = new Map<
      string,
      Partial<ClaudeCodeSessionAggregate>[]
    >();
    const touchedSessions = new Set<string>();

    const files = await glob(this.filesGlob);
    const noSessionFiles = files.length === 0;

    for (const filePath of files) {
      const cursorKey = `${SOURCE_ID}:${filePath}`;
      const prevCursor = this.state.getCursor(cursorKey);

      let newCursor;
      try {
        const outcome = scanJsonlFile<ParsedLine>(
          filePath,
          prevCursor,
          (line) => parseClaudeCodeLine(line, filePath),
        );
        newCursor = outcome.cursor;

        for (const parsed of outcome.records) {
          if (!parsed.sessionExternalId) continue;
          touchedSessions.add(parsed.sessionExternalId);
          if (parsed.activity) {
            this.attachOtelRequestCost(parsed.activity);
            events.push(parsed.activity);
          }
          if (parsed.sessionUpdate) {
            const list =
              pendingAggregateUpdates.get(parsed.sessionExternalId) ?? [];
            list.push(parsed.sessionUpdate);
            pendingAggregateUpdates.set(parsed.sessionExternalId, list);
          }
        }
      } catch (err) {
        console.error(
          `[claude-code] failed scanning ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
        );
        continue;
      }

      this.state.setCursor(cursorKey, newCursor);
    }

    // Session-level $ from the OTel `claude_code.cost.usage` metric — this is
    // the authoritative cost total (per-activity costUsd above is best-effort
    // real-time correlation and may miss timing races; this metric-derived
    // total does not depend on that correlation succeeding). A session can be
    // "touched" here even with no new JSONL lines this tick, e.g. a cost
    // delta arriving after the CLI process has already exited.
    for (const {
      sessionExternalId,
      deltaUsd,
    } of this.otelReceiver.drainSessionCostDeltas()) {
      touchedSessions.add(sessionExternalId);
      const list = pendingAggregateUpdates.get(sessionExternalId) ?? [];
      list.push({ costUsd: deltaUsd });
      pendingAggregateUpdates.set(sessionExternalId, list);
    }

    // Emit an updated session snapshot for every session touched this tick.
    for (const externalId of touchedSessions) {
      const aggKey = `${SOURCE_ID}:${externalId}`;
      let agg =
        this.state.getAggregate<ClaudeCodeSessionAggregate>(aggKey) ??
        emptyAggregate(externalId);
      const updates = pendingAggregateUpdates.get(externalId) ?? [];
      for (const update of updates) {
        agg = mergeSessionUpdate(agg, update);
      }
      this.state.setAggregate(aggKey, agg);

      events.push({
        kind: "session",
        // Unique per observation (not per session) so ingest_dedupe never
        // blocks a legitimate later update to the same session — see
        // src/types/ingest.ts naturalKey doc comment. costUsd is included
        // since an OTel-only tick can otherwise leave turnCount/endedAt
        // unchanged, which would make the key collide with the previous
        // observation and get silently deduped away.
        naturalKey: `${externalId}@${agg.endedAt ?? ""}:${agg.turnCount}:${agg.costUsd ?? ""}`,
        payload: aggregateToSessionPayload(agg),
      });
    }

    // Plan-usage OAuth poll (every 5 min). Can emit events even when no session
    // files changed — do not early-return solely on empty session scan.
    const nowMs = Date.now();
    if (nowMs - this.lastUsagePollMs >= CLAUDE_USAGE_POLL_INTERVAL_MS) {
      // Set before the attempt so failures don't retry every 30s tick.
      this.lastUsagePollMs = nowMs;
      const quotaEvents = await pollClaudeUsageEvents({
        credPath: this.credentialsPath,
        onWarn: (m) => console.warn(`[claude-code] ${m}`),
      });
      events.push(...quotaEvents);
    }

    if (events.length === 0) {
      if (noSessionFiles) {
        return {
          eventsEmitted: 0,
          sourceStatus: "off",
          detail: "no session files found",
        };
      }
      return { eventsEmitted: 0, sourceStatus: "ok" };
    }

    await sendBatched(sink, SOURCE_ID, INSTANCE_ID, COLLECTOR_VERSION, events);
    // Only persist cursors/aggregates once the send succeeded.
    this.state.persist();

    return { eventsEmitted: events.length, sourceStatus: "ok" };
  }

  /** Closes the OTLP receiver's socket. Call on process shutdown. */
  async close(): Promise<void> {
    await this.otelReceiver.stop();
  }

  /**
   * Attach real $ from a matching `claude_code.api_request` OTel event onto
   * this activity, correlated by `requestId`. Best-effort: if the OTel
   * export for this request hasn't arrived yet (or the user hasn't opted
   * in), the activity is emitted without costUsd, unchanged from today.
   */
  private attachOtelRequestCost(event: IngestEvent): void {
    if (event.kind !== "activity") return;
    const payload = event.payload as ActivityPayload;
    if (!payload.requestId) return;
    const match = this.otelReceiver.getRequestCost(payload.requestId);
    if (!match) return;
    payload.costUsd = match.costUsd;
    this.otelReceiver.consumeRequestCost(payload.requestId);
  }
}
