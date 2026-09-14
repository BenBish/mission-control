import { describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { ClaudeCodeCollector } from "../../../collectors/claude-code/collector.js";
import type { FileCursor } from "../../../collectors/core/jsonl-scanner.js";
import type {
  ActivityPayload,
  IngestBatch,
  Sink,
  Heartbeat,
  SessionPayload,
} from "../../../types/ingest.js";
import { FakeOtelReceiver } from "./noop-otel-receiver.js";

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

// No credentials file present anywhere these tests point at, so the OAuth
// usage poll silently no-ops (readClaudeOAuthToken returns null) — these
// tests exist to isolate OTel correlation, not the usage poller.
function noCredsPath(root: string) {
  return path.join(root, ".credentials-does-not-exist.json");
}

describe("ClaudeCodeCollector OTel correlation", () => {
  test("attaches real costUsd to the matching activity by requestId", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-claude-otel-"));
    const sessionsDir = path.join(root, "projects");
    fs.mkdirSync(sessionsDir, { recursive: true });

    const sessionId = "sess-abc";
    const record = {
      type: "assistant",
      sessionId,
      uuid: "turn-1",
      parentUuid: null,
      timestamp: "2026-09-12T00:00:00.000Z",
      requestId: "req-xyz",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "hi" }],
        model: "claude-sonnet-4.5",
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    };
    fs.writeFileSync(
      path.join(sessionsDir, "s.jsonl"),
      JSON.stringify(record) + "\n",
    );

    const otel = new FakeOtelReceiver();
    otel.seedRequestCost({ requestId: "req-xyz", costUsd: 0.0421 });

    const state = new MemoryState();
    const sink = new CapturingSink();
    const collector = new ClaudeCodeCollector(
      state as never,
      path.join(sessionsDir, "**/*.jsonl"),
      noCredsPath(root),
      otel,
    );

    await collector.tick(sink);

    const activityEvent = sink.batches[0].events.find(
      (e) => e.kind === "activity",
    );
    expect((activityEvent?.payload as ActivityPayload).costUsd).toBe(0.0421);
    // Consumed — a second, unrelated tick must not reuse the same cost entry.
    expect(otel.getRequestCost("req-xyz")).toBeUndefined();

    fs.rmSync(root, { recursive: true, force: true });
  });

  test("emits a session snapshot with costUsd from a metrics-derived delta, even with no new JSONL lines that tick", async () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "mc-claude-otel-session-"),
    );
    const sessionsDir = path.join(root, "projects");
    fs.mkdirSync(sessionsDir, { recursive: true });

    const otel = new FakeOtelReceiver();
    otel.seedSessionCostDelta({
      sessionExternalId: "sess-only-cost",
      deltaUsd: 0.5,
    });

    const state = new MemoryState();
    const sink = new CapturingSink();
    const collector = new ClaudeCodeCollector(
      state as never,
      path.join(sessionsDir, "**/*.jsonl"),
      noCredsPath(root),
      otel,
    );

    const result = await collector.tick(sink);
    expect(result.sourceStatus).toBe("ok");

    const sessionEvent = sink.batches[0].events.find(
      (e) => e.kind === "session",
    );
    expect(sessionEvent).toBeDefined();
    const payload = sessionEvent!.payload as SessionPayload;
    expect(payload.externalId).toBe("sess-only-cost");
    expect(payload.costUsd).toBe(0.5);

    fs.rmSync(root, { recursive: true, force: true });
  });

  test("without any OTel data, costUsd stays undefined on both activity and session payloads", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-claude-no-otel-"));
    const sessionsDir = path.join(root, "projects");
    fs.mkdirSync(sessionsDir, { recursive: true });

    const record = {
      type: "assistant",
      sessionId: "sess-plain",
      uuid: "turn-1",
      parentUuid: null,
      timestamp: "2026-09-12T00:00:00.000Z",
      requestId: "req-unmatched",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "hi" }],
        model: "claude-sonnet-4.5",
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    };
    fs.writeFileSync(
      path.join(sessionsDir, "s.jsonl"),
      JSON.stringify(record) + "\n",
    );

    const state = new MemoryState();
    const sink = new CapturingSink();
    const collector = new ClaudeCodeCollector(
      state as never,
      path.join(sessionsDir, "**/*.jsonl"),
      noCredsPath(root),
      new FakeOtelReceiver(),
    );

    await collector.tick(sink);

    const activityEvent = sink.batches[0].events.find(
      (e) => e.kind === "activity",
    );
    const sessionEvent = sink.batches[0].events.find(
      (e) => e.kind === "session",
    );
    expect((activityEvent?.payload as ActivityPayload).costUsd).toBeUndefined();
    expect((sessionEvent?.payload as SessionPayload).costUsd).toBeUndefined();

    fs.rmSync(root, { recursive: true, force: true });
  });
});
