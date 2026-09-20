import { describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { CloudHandoffCollector } from "../../../collectors/cloud-handoff/collector.js";
import { readCloudHandoffConfig } from "../../../collectors/cloud-handoff/config.js";
import { parseEventStream } from "../../../collectors/cloud-handoff/client.js";
import type { FileCursor } from "../../../collectors/core/jsonl-scanner.js";
import type { IngestBatch, Sink, Heartbeat } from "../../../types/ingest.js";

class MemoryState {
  aggregates = new Map<string, unknown>();
  persisted = false;

  getCursor(_key: string): FileCursor | undefined {
    return undefined;
  }
  setCursor(_key: string, _cursor: FileCursor) {}
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

function sseBody(
  events: Array<{
    id: number;
    sessionId: string;
    type: string;
    payload?: Record<string, unknown>;
  }>,
): string {
  return events
    .map(
      (e) =>
        `id: ${e.id}\nevent: ${e.type}\ndata: ${JSON.stringify({ ...e, createdAt: "2026-09-16T10:00:00.000Z", payload: e.payload ?? {} })}\n`,
    )
    .join("\n");
}

function makeFetch(handlers: {
  sessions?: unknown[] | (() => Response);
  events?: Record<string, string | (() => Response)>;
}) {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/v1/sessions")) {
      const s = handlers.sessions;
      if (typeof s === "function") return s();
      return new Response(JSON.stringify(s ?? []), { status: 200 });
    }
    const match = url.match(/\/v1\/sessions\/([^/]+)\/events\?after=(\d+)/);
    if (match) {
      const handler = handlers.events?.[match[1]!];
      if (typeof handler === "function") return handler();
      return new Response(
        typeof handler === "string" ? handler : ": keepalive\n\n",
        {
          status: 200,
        },
      );
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

function writeConfig(root: string, url = "https://cp.example", token = "tok") {
  const file = path.join(root, "config");
  fs.writeFileSync(file, JSON.stringify({ url, token }));
  return file;
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ch-collector-"));
}

describe("readCloudHandoffConfig", () => {
  test("reads url/token from the config file", () => {
    const root = tmpDir();
    const file = writeConfig(root);
    const cfg = readCloudHandoffConfig(file, {});
    expect(cfg).toEqual({ url: "https://cp.example", token: "tok" });
  });

  test("env vars win over the file", () => {
    const root = tmpDir();
    const file = writeConfig(root);
    const cfg = readCloudHandoffConfig(file, {
      CLOUD_HANDOFF_URL: "https://env.example/",
      CLOUD_HANDOFF_TOKEN: "env-tok",
    });
    expect(cfg).toEqual({ url: "https://env.example", token: "env-tok" });
  });

  test("returns null when nothing is configured", () => {
    const cfg = readCloudHandoffConfig(path.join(tmpDir(), "missing"), {});
    expect(cfg).toBeNull();
  });
});

describe("parseEventStream", () => {
  test("parses data frames and skips malformed ones", () => {
    const body =
      sseBody([
        {
          id: 1,
          sessionId: "s1",
          type: "agent.usage",
          payload: { inputTokens: 5 },
        },
        { id: 2, sessionId: "s1", type: "agent.message" },
      ]) + "data: {not json\n\n: keepalive\n\n";
    const events = parseEventStream(body);
    expect(events).toHaveLength(2);
    expect(events[0]!.type).toBe("agent.usage");
    expect(events[0]!.payload.inputTokens).toBe(5);
  });
});

describe("CloudHandoffCollector", () => {
  test("reports off when not configured", async () => {
    const collector = new CloudHandoffCollector(
      new MemoryState(),
      path.join(tmpDir(), "missing"),
      makeFetch({}),
    );
    const result = await collector.tick(new CapturingSink());
    expect(result.sourceStatus).toBe("off");
    expect(result.eventsEmitted).toBe(0);
  });

  test("reports error when the sessions list fails", async () => {
    const root = tmpDir();
    const collector = new CloudHandoffCollector(
      new MemoryState(),
      writeConfig(root),
      makeFetch({ sessions: () => new Response("nope", { status: 500 }) }),
    );
    const result = await collector.tick(new CapturingSink());
    expect(result.sourceStatus).toBe("error");
  });

  test("emits activity + session events from agent.usage and dedupes on re-poll", async () => {
    const root = tmpDir();
    const state = new MemoryState();
    const sink = new CapturingSink();
    const sessions = [
      {
        id: "s1",
        status: "running",
        task: "Fix the thing",
        createdAt: "2026-09-16T09:00:00.000Z",
        updatedAt: "2026-09-16T09:30:00.000Z",
        agentExecutionSnapshot: { harness: "grok", model: "grok-4.5" },
      },
    ];
    const events = sseBody([
      {
        id: 7,
        sessionId: "s1",
        type: "agent.usage",
        payload: { inputTokens: 100, cachedInputTokens: 40, outputTokens: 25 },
      },
      {
        id: 8,
        sessionId: "s1",
        type: "agent.message",
        payload: { text: "hi" },
      },
    ]);
    const collector = new CloudHandoffCollector(
      state,
      writeConfig(root),
      makeFetch({ sessions, events: { s1: events } }),
    );

    const first = await collector.tick(sink);
    expect(first.sourceStatus).toBe("ok");
    const emitted = sink.batches.flatMap((b) => b.events);
    const activity = emitted.find((e) => e.kind === "activity");
    const session = emitted.find((e) => e.kind === "session");
    expect(activity?.naturalKey).toBe("usage:s1:7");
    expect(activity?.payload).toMatchObject({
      sessionExternalId: "s1",
      inputTokens: 100,
      outputTokens: 25,
      cacheReadTokens: 40,
      model: "grok-4.5",
    });
    expect(session?.payload).toMatchObject({
      externalId: "s1",
      inputTokens: 100,
      outputTokens: 25,
      cacheReadTokens: 40,
      title: "Fix the thing",
    });

    // Second tick: no new events → nothing re-emitted.
    const second = await collector.tick(sink);
    expect(second.eventsEmitted).toBe(0);
  });

  test("maps turn.completed usage (snake_case) into activities and session totals", async () => {
    const root = tmpDir();
    const state = new MemoryState();
    const sink = new CapturingSink();
    const sessions = [
      {
        id: "s1",
        status: "running",
        task: "Codex-harness work",
        createdAt: "2026-09-18T09:00:00.000Z",
        updatedAt: "2026-09-18T09:30:00.000Z",
        agentExecutionSnapshot: { harness: "codex", model: "gpt-5.2" },
      },
    ];
    const events = sseBody([
      { id: 4, sessionId: "s1", type: "turn.started", payload: {} },
      {
        id: 5,
        sessionId: "s1",
        type: "turn.completed",
        payload: {
          usage: {
            input_tokens: 1000,
            cached_input_tokens: 800,
            cache_write_input_tokens: 50,
            output_tokens: 120,
          },
        },
      },
      { id: 6, sessionId: "s1", type: "turn.completed", payload: {} },
    ]);
    const collector = new CloudHandoffCollector(
      state,
      writeConfig(root),
      makeFetch({ sessions, events: { s1: events } }),
    );

    const result = await collector.tick(sink);
    expect(result.sourceStatus).toBe("ok");
    const emitted = sink.batches.flatMap((b) => b.events);
    const activity = emitted.find((e) => e.kind === "activity");
    expect(activity?.naturalKey).toBe("usage:s1:5");
    expect(activity?.payload).toMatchObject({
      sessionExternalId: "s1",
      externalId: "turn.completed:5",
      inputTokens: 1000,
      outputTokens: 120,
      cacheReadTokens: 800,
      cacheWriteTokens: 50,
      model: "gpt-5.2",
    });
    const session = emitted.find((e) => e.kind === "session");
    expect(session?.payload).toMatchObject({
      externalId: "s1",
      inputTokens: 1000,
      outputTokens: 120,
      cacheReadTokens: 800,
      cacheWriteTokens: 50,
    });
  });

  test("backfills turn.completed usage for already-drained done sessions without double-counting", async () => {
    const root = tmpDir();
    const state = new MemoryState();
    // Legacy state: stream consumed through id 9, marked done, but written
    // before turn.completed support (no turnUsageDrained flag).
    state.aggregates.set("cloud-handoff:s1", {
      lastEventId: 9,
      inputTokens: 100,
      outputTokens: 25,
      cacheReadTokens: 40,
      emitted: true,
      done: true,
    });
    const sink = new CapturingSink();
    const afters: string[] = [];
    const sessions = [
      {
        id: "s1",
        status: "completed",
        task: "Done work",
        createdAt: "2026-09-16T09:00:00.000Z",
        updatedAt: "2026-09-16T10:00:00.000Z",
      },
    ];
    const collector = new CloudHandoffCollector(
      state,
      writeConfig(root),
      (async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/v1/sessions")) {
          return new Response(JSON.stringify(sessions), { status: 200 });
        }
        const m = url.match(/\/v1\/sessions\/([^/]+)\/events\?after=(\d+)/);
        if (m) {
          afters.push(m[2]!);
          return new Response(
            sseBody([
              // Below watermark — already counted, must not double-count.
              {
                id: 3,
                sessionId: "s1",
                type: "agent.usage",
                payload: { inputTokens: 100, outputTokens: 25 },
              },
              // Below watermark but never counted — the backfill target.
              {
                id: 7,
                sessionId: "s1",
                type: "turn.completed",
                payload: {
                  usage: { input_tokens: 500, output_tokens: 60 },
                },
              },
              { id: 9, sessionId: "s1", type: "session.completed" },
            ]),
            { status: 200 },
          );
        }
        return new Response("not found", { status: 404 });
      }) as typeof fetch,
    );

    const first = await collector.tick(sink);
    expect(first.sourceStatus).toBe("ok");
    expect(afters).toEqual(["0"]);
    const emitted = sink.batches.flatMap((b) => b.events);
    // Only the turn.completed usage activity — not a re-emitted agent.usage.
    const activities = emitted.filter((e) => e.kind === "activity");
    expect(activities.map((e) => e.naturalKey)).toEqual(["usage:s1:7"]);
    const session = emitted.find((e) => e.kind === "session");
    expect(session?.payload).toMatchObject({
      externalId: "s1",
      inputTokens: 600,
      outputTokens: 85,
      cacheReadTokens: 40,
    });

    // Second tick: done + drained → no fetch at all.
    sink.batches.length = 0;
    const second = await collector.tick(sink);
    expect(second.eventsEmitted).toBe(0);
    expect(afters).toEqual(["0"]);
  });

  test("marks terminal sessions done and stops polling them", async () => {
    const root = tmpDir();
    const state = new MemoryState();
    const sink = new CapturingSink();
    let eventFetches = 0;
    const sessions = [
      {
        id: "s1",
        status: "completed",
        task: "Done work",
        createdAt: "2026-09-16T09:00:00.000Z",
        updatedAt: "2026-09-16T10:00:00.000Z",
      },
    ];
    const collector = new CloudHandoffCollector(
      state,
      writeConfig(root),
      makeFetch({
        sessions,
        events: {
          s1: () => {
            eventFetches++;
            return new Response(
              sseBody([
                {
                  id: 3,
                  sessionId: "s1",
                  type: "agent.usage",
                  payload: { inputTokens: 10, outputTokens: 5, costUsd: 0.01 },
                },
              ]),
              { status: 200 },
            );
          },
        },
      }),
    );

    const first = await collector.tick(sink);
    expect(first.sourceStatus).toBe("ok");
    expect(eventFetches).toBe(1);
    const session = sink.batches
      .flatMap((b) => b.events)
      .find((e) => e.kind === "session");
    expect(session?.payload).toMatchObject({
      externalId: "s1",
      endedAt: "2026-09-16T10:00:00.000Z",
      costUsd: 0.01,
    });

    await collector.tick(sink);
    expect(eventFetches).toBe(1);
  });

  test("continues other sessions when one events fetch fails", async () => {
    const root = tmpDir();
    const sink = new CapturingSink();
    const sessions = [
      {
        id: "bad",
        status: "running",
        createdAt: "2026-09-16T09:00:00.000Z",
        updatedAt: "2026-09-16T09:00:00.000Z",
      },
      {
        id: "good",
        status: "running",
        createdAt: "2026-09-16T09:00:00.000Z",
        updatedAt: "2026-09-16T09:00:00.000Z",
      },
    ];
    const collector = new CloudHandoffCollector(
      new MemoryState(),
      writeConfig(root),
      makeFetch({
        sessions,
        events: {
          bad: () => new Response("boom", { status: 500 }),
          good: sseBody([
            {
              id: 1,
              sessionId: "good",
              type: "agent.usage",
              payload: { inputTokens: 3, outputTokens: 1 },
            },
          ]),
        },
      }),
    );

    const result = await collector.tick(sink);
    expect(result.sourceStatus).toBe("error");
    const emitted = sink.batches.flatMap((b) => b.events);
    expect(emitted.some((e) => e.naturalKey === "usage:good:1")).toBe(true);
  });
});
