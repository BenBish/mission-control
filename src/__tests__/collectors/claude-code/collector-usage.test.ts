import { afterEach, describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { ClaudeCodeCollector } from "../../../collectors/claude-code/collector.js";
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

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("ClaudeCodeCollector usage poll", () => {
  test("emits quota_snapshot events when session files are empty but OAuth usage succeeds", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-claude-usage-"));
    const emptySessions = path.join(root, "projects");
    fs.mkdirSync(emptySessions, { recursive: true });
    const credPath = path.join(root, ".credentials.json");
    fs.writeFileSync(
      credPath,
      JSON.stringify({
        claudeAiOauth: {
          accessToken: "test-token-not-real",
          expiresAt: Date.now() + 60 * 60 * 1000,
        },
      }),
    );

    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          five_hour: {
            utilization: 42,
            resets_at: "2026-08-10T17:00:00.000Z",
          },
          seven_day: {
            utilization: 10,
            resets_at: "2026-08-12T00:00:00.000Z",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as typeof fetch;

    const state = new MemoryState();
    const sink = new CapturingSink();
    const collector = new ClaudeCodeCollector(
      state as never,
      path.join(emptySessions, "**/*.jsonl"),
      credPath,
    );

    const result = await collector.tick(sink);
    expect(result.eventsEmitted).toBeGreaterThanOrEqual(2);
    expect(result.sourceStatus).toBe("ok");
    expect(sink.batches).toHaveLength(1);
    const kinds = sink.batches[0].events.map((e) => e.kind);
    expect(kinds.every((k) => k === "quota_snapshot")).toBe(true);
    const limitIds = sink.batches[0].events.map(
      (e) => (e.payload as { limitId: string }).limitId,
    );
    expect(limitIds).toContain("claude:5h");
    expect(limitIds).toContain("claude:7d");
    expect(state.persisted).toBe(true);

    // Second tick within the 5m gate should not re-poll / re-emit
    const result2 = await collector.tick(sink);
    expect(result2.eventsEmitted).toBe(0);
    expect(result2.sourceStatus).toBe("off");
    expect(sink.batches).toHaveLength(1);

    fs.rmSync(root, { recursive: true, force: true });
  });
});
