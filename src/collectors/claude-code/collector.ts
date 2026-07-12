import { glob } from "glob";
import os from "os";
import type { Collector, TickResult } from "../core/types.js";
import type { IngestEvent, Sink } from "../../types/ingest.js";
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

const SOURCE_ID = "claude-code";
const INSTANCE_ID = "claude-code@arch-desktop";
const DEFAULT_GLOB = `${os.homedir()}/.claude/projects/**/*.jsonl`;
const COLLECTOR_VERSION = "0.1.0";

export class ClaudeCodeCollector implements Collector {
  sourceId = SOURCE_ID;
  instanceId = INSTANCE_ID;
  intervalMs = 30_000;

  constructor(
    private state: CollectorStateStore,
    private filesGlob: string = DEFAULT_GLOB,
  ) {}

  async tick(sink: Sink): Promise<TickResult> {
    const files = await glob(this.filesGlob);
    if (files.length === 0) {
      return {
        eventsEmitted: 0,
        sourceStatus: "off",
        detail: "no session files found",
      };
    }

    const events: IngestEvent[] = [];
    // externalId -> updates seen this tick (merged into the persisted aggregate
    // only after a successful send, so a failed batch can be retried safely).
    const pendingAggregateUpdates = new Map<
      string,
      Partial<ClaudeCodeSessionAggregate>[]
    >();
    const touchedSessions = new Set<string>();

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
          if (parsed.activity) events.push(parsed.activity);
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
        // src/types/ingest.ts naturalKey doc comment.
        naturalKey: `${externalId}@${agg.endedAt ?? ""}:${agg.turnCount}`,
        payload: aggregateToSessionPayload(agg),
      });
    }

    if (events.length === 0) {
      return { eventsEmitted: 0, sourceStatus: "ok" };
    }

    await sendBatched(sink, SOURCE_ID, INSTANCE_ID, COLLECTOR_VERSION, events);
    // Only persist cursors/aggregates once the send succeeded.
    this.state.persist();

    return { eventsEmitted: events.length, sourceStatus: "ok" };
  }
}
