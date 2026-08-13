import { afterEach, describe, expect, test } from "bun:test";
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

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("GrokCollector usage poll", () => {
  test("emits quota_snapshot events when session files are empty but billing succeeds", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-grok-usage-"));
    const emptySessions = path.join(root, "sessions");
    fs.mkdirSync(emptySessions, { recursive: true });
    const authPath = path.join(root, "auth.json");
    fs.writeFileSync(
      authPath,
      JSON.stringify({
        "https://auth.x.ai::example": {
          key: "test-token-not-real",
          auth_mode: "oidc",
          expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        },
      }),
    );

    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          config: {
            currentPeriod: {
              type: "USAGE_PERIOD_TYPE_WEEKLY",
              start: "2026-08-10T00:00:00.000Z",
              end: "2026-08-17T00:00:00.000Z",
            },
            creditUsagePercent: 53,
            productUsage: [{ product: "GrokBuild", usagePercent: 53 }],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as typeof fetch;

    const state = new MemoryState();
    const sink = new CapturingSink();
    const collector = new GrokCollector(
      state as never,
      path.join(emptySessions, "*", "*", "updates.jsonl"),
      authPath,
    );

    const result = await collector.tick(sink);
    expect(result.eventsEmitted).toBeGreaterThanOrEqual(1);
    expect(result.sourceStatus).toBe("ok");
    expect(sink.batches).toHaveLength(1);
    const kinds = sink.batches[0].events.map((e) => e.kind);
    expect(kinds.every((k) => k === "quota_snapshot")).toBe(true);
    const limitIds = sink.batches[0].events.map(
      (e) => (e.payload as { limitId: string }).limitId,
    );
    expect(limitIds).toContain("grok:week");
    expect(state.persisted).toBe(true);

    const result2 = await collector.tick(sink);
    expect(result2.eventsEmitted).toBe(0);
    expect(result2.sourceStatus).toBe("off");
    expect(sink.batches).toHaveLength(1);

    fs.rmSync(root, { recursive: true, force: true });
  });
});
