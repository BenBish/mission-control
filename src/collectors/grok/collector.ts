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
  parseGrokLine,
  readGrokSessionSnapshot,
  type GrokSessionAggregate,
  type ParsedLine,
} from "./parser.js";

const SOURCE_ID = "grok";
const INSTANCE_ID = "grok@arch-desktop";
const DEFAULT_GLOB = `${os.homedir()}/.grok/sessions/*/*/updates.jsonl`;
const COLLECTOR_VERSION = "0.1.0";

interface StateStore {
  getCursor: CollectorStateStore["getCursor"];
  setCursor: CollectorStateStore["setCursor"];
  getAggregate: CollectorStateStore["getAggregate"];
  setAggregate: CollectorStateStore["setAggregate"];
  persist: CollectorStateStore["persist"];
}

export class GrokCollector implements Collector {
  sourceId = SOURCE_ID;
  instanceId = INSTANCE_ID;
  intervalMs = 30_000;

  constructor(
    private state: StateStore,
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
    const pendingUpdates = new Map<string, Partial<GrokSessionAggregate>[]>();
    const pendingDeltas = new Map<
      string,
      { toolCallDelta: number; failureDelta: number }
    >();
    const sessionFiles = new Map<string, string>();
    const touchedSessions = new Set<string>();

    for (const filePath of files) {
      const cursorKey = `${SOURCE_ID}:${filePath}`;
      const prevCursor = this.state.getCursor(cursorKey);

      let newCursor;
      try {
        const outcome = scanJsonlFile<ParsedLine>(
          filePath,
          prevCursor,
          (line) => parseGrokLine(line, filePath),
        );
        newCursor = outcome.cursor;

        for (const parsed of outcome.records) {
          touchedSessions.add(parsed.sessionExternalId);
          sessionFiles.set(parsed.sessionExternalId, filePath);
          if (parsed.activity) events.push(parsed.activity);
          if (parsed.sessionUpdate) {
            const updates = pendingUpdates.get(parsed.sessionExternalId) ?? [];
            updates.push(parsed.sessionUpdate);
            pendingUpdates.set(parsed.sessionExternalId, updates);
          }
          if (parsed.toolCallDelta || parsed.failureDelta) {
            const deltas = pendingDeltas.get(parsed.sessionExternalId) ?? {
              toolCallDelta: 0,
              failureDelta: 0,
            };
            deltas.toolCallDelta += parsed.toolCallDelta ?? 0;
            deltas.failureDelta += parsed.failureDelta ?? 0;
            pendingDeltas.set(parsed.sessionExternalId, deltas);
          }
        }
      } catch (err) {
        console.error(
          `[grok] failed scanning ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
        );
        continue;
      }

      this.state.setCursor(cursorKey, newCursor);
    }

    for (const externalId of touchedSessions) {
      const aggKey = `${SOURCE_ID}:${externalId}`;
      let agg =
        this.state.getAggregate<GrokSessionAggregate>(aggKey) ??
        emptyAggregate(externalId);
      let snapshot: Partial<GrokSessionAggregate> = {};
      const filePath = sessionFiles.get(externalId);
      if (filePath) {
        snapshot = readGrokSessionSnapshot(filePath);
        agg = mergeSessionUpdate(agg, snapshot);
      }
      for (const update of pendingUpdates.get(externalId) ?? []) {
        agg = mergeSessionUpdate(agg, update);
      }
      const deltas = pendingDeltas.get(externalId);
      if (deltas) {
        if (snapshot.toolCallCount === undefined) {
          agg.toolCallCount += deltas.toolCallDelta;
        }
        if (snapshot.failureCount === undefined) {
          agg.failureCount += deltas.failureDelta;
        }
      }
      this.state.setAggregate(aggKey, agg);

      events.push({
        kind: "session",
        naturalKey: `${externalId}@${agg.endedAt ?? ""}:${agg.turnCount}:${agg.toolCallCount}:${agg.inputTokens}:${agg.outputTokens}`,
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
