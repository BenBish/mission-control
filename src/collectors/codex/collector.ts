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
  parseCodexLine,
  type CodexSessionAggregate,
  type ParsedLine,
} from "./parser.js";

const SOURCE_ID = "codex";
const INSTANCE_ID = "codex@arch-desktop";
const DEFAULT_GLOB = `${os.homedir()}/.codex/sessions/**/rollout-*.jsonl`;
const COLLECTOR_VERSION = "0.1.0";

export class CodexCollector implements Collector {
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
    const pendingUpdates = new Map<
      string,
      {
        updates: Partial<CodexSessionAggregate>[];
        turnDelta: number;
        toolCallDelta: number;
      }
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
          (line) => parseCodexLine(line, filePath),
        );
        newCursor = outcome.cursor;

        for (const parsed of outcome.records) {
          touchedSessions.add(parsed.sessionExternalId);
          if (parsed.activity) events.push(parsed.activity);
          if (parsed.quotaSnapshots) events.push(...parsed.quotaSnapshots);

          const entry = pendingUpdates.get(parsed.sessionExternalId) ?? {
            updates: [],
            turnDelta: 0,
            toolCallDelta: 0,
          };
          if (parsed.sessionUpdate) entry.updates.push(parsed.sessionUpdate);
          entry.turnDelta += parsed.turnDelta ?? 0;
          entry.toolCallDelta += parsed.toolCallDelta ?? 0;
          pendingUpdates.set(parsed.sessionExternalId, entry);
        }
      } catch (err) {
        console.error(
          `[codex] failed scanning ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
        );
        continue;
      }

      this.state.setCursor(cursorKey, newCursor);
    }

    for (const externalId of touchedSessions) {
      const aggKey = `${SOURCE_ID}:${externalId}`;
      let agg =
        this.state.getAggregate<CodexSessionAggregate>(aggKey) ??
        emptyAggregate(externalId);
      const entry = pendingUpdates.get(externalId);
      if (entry) {
        for (const update of entry.updates) {
          agg = mergeSessionUpdate(agg, update, 0, 0);
        }
        agg = mergeSessionUpdate(agg, {}, entry.turnDelta, entry.toolCallDelta);
      }
      this.state.setAggregate(aggKey, agg);

      events.push({
        kind: "session",
        naturalKey: `${externalId}@${agg.endedAt ?? ""}:${agg.turnCount}:${agg.toolCallCount}`,
        payload: aggregateToSessionPayload(agg),
      });
    }

    if (events.length === 0) {
      return { eventsEmitted: 0, sourceStatus: "ok" };
    }

    await sendBatched(sink, SOURCE_ID, INSTANCE_ID, COLLECTOR_VERSION, events);
    this.state.persist();

    return { eventsEmitted: events.length, sourceStatus: "ok" };
  }
}
