import { describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { GrokCollector } from "../../../collectors/grok/collector.js";
import type { FileCursor } from "../../../collectors/core/jsonl-scanner.js";
import type { IngestBatch, Sink, Heartbeat } from "../../../types/ingest.js";

class MemoryState {
  cursors = new Map<string, FileCursor>();
  aggregates = new Map<string, unknown>();
  persisted = false;

  getCursor(key: string) {
    return this.cursors.get(key);
  }

  setCursor(key: string, cursor: FileCursor) {
    this.cursors.set(key, cursor);
  }

  getAggregate<T>(key: string): T | undefined {
    return this.aggregates.get(key) as T | undefined;
  }

  setAggregate<T>(key: string, value: T) {
    this.aggregates.set(key, value);
  }

  persist() {
    this.persisted = true;
  }
}

class CapturingSink implements Sink {
  batches: IngestBatch[] = [];

  async send(batch: IngestBatch) {
    this.batches.push(batch);
    return { accepted: batch.events.length, duplicates: 0, rejected: [] };
  }

  async heartbeat(_beat: Heartbeat) {}
}

function writeSession(root: string) {
  const cwd = "/home/ben/Dev/mission-control";
  const sessionId = "019f6879-489f-7350-811c-b045352c43d0";
  const dir = path.join(root, encodeURIComponent(cwd), sessionId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "summary.json"),
    JSON.stringify({
      current_model_id: "grok-4.5",
      generated_title: "Mission Control work",
      created_at: 1784164225,
      updated_at: 1784166071,
      git_root_dir: cwd,
      head_branch: "main",
    }),
  );
  fs.writeFileSync(
    path.join(dir, "signals.json"),
    JSON.stringify({ turnCount: 3, toolCallCount: 1 }),
  );
  fs.writeFileSync(
    path.join(dir, "updates.jsonl"),
    [
      JSON.stringify({
        method: "session/update",
        timestamp: 1784164227,
        params: {
          sessionId,
          _meta: {
            eventId: "event-tool",
            updateParams: {
              status: "Pending",
              title: "read_file",
              toolCallId: "call-1",
            },
          },
          update: {
            toolCallId: "call-1",
            title: "read_file",
            _meta: { "x.ai/tool": { name: "read_file" } },
          },
        },
      }),
      JSON.stringify({
        method: "_x.ai/session/update",
        timestamp: 1784166071,
        params: {
          sessionId,
          _meta: { eventId: "event-usage" },
          update: {
            usage: {
              inputTokens: 1000,
              outputTokens: 50,
              totalTokens: 1050,
              cachedReadTokens: 800,
              numTurns: 3,
              modelUsage: {
                "grok-4.5": {
                  inputTokens: 1000,
                  outputTokens: 50,
                  totalTokens: 1050,
                },
              },
            },
          },
        },
      }),
      "",
    ].join("\n"),
  );
}

describe("GrokCollector", () => {
  test("reports off when no Grok session files exist", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-grok-empty-"));
    try {
      const state = new MemoryState();
      const collector = new GrokCollector(
        state,
        path.join(root, "*", "*", "updates.jsonl"),
      );
      const sink = new CapturingSink();

      const result = await collector.tick(sink);

      expect(result).toEqual({
        eventsEmitted: 0,
        sourceStatus: "off",
        detail: "no session files found",
      });
      expect(sink.batches).toHaveLength(0);
      expect(state.persisted).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("emits Grok activities and a session snapshot on a tick", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-grok-session-"));
    try {
      writeSession(root);
      const state = new MemoryState();
      const collector = new GrokCollector(
        state,
        path.join(root, "*", "*", "updates.jsonl"),
      );
      const sink = new CapturingSink();

      const result = await collector.tick(sink);

      expect(result.sourceStatus).toBe("ok");
      expect(result.eventsEmitted).toBe(3);
      expect(state.persisted).toBe(true);
      expect(sink.batches).toHaveLength(1);
      expect(sink.batches[0].sourceId).toBe("grok");
      expect(sink.batches[0].instanceId).toBe("grok@arch-desktop");

      const events = sink.batches[0].events;
      expect(events.filter((event) => event.kind === "activity")).toHaveLength(
        2,
      );
      const session = events.find((event) => event.kind === "session");
      expect(session?.payload).toMatchObject({
        externalId: "019f6879-489f-7350-811c-b045352c43d0",
        cwd: "/home/ben/Dev/mission-control",
        gitBranch: "main",
        title: "Mission Control work",
        modelProvider: "xai",
        turnCount: 3,
        toolCallCount: 1,
        inputTokens: 1000,
        outputTokens: 50,
        cacheReadTokens: 800,
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
