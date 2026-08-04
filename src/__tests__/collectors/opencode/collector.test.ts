import { describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { Database } from "bun:sqlite";
import { OpenCodeCollector } from "../../../collectors/opencode/collector.js";
import type { IngestBatch, Sink, Heartbeat } from "../../../types/ingest.js";

class MemoryState {
  aggregates = new Map<string, unknown>();
  persisted = false;

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

function createFixtureDb(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-opencode-"));
  const dbPath = path.join(dir, "opencode.db");
  const db = new Database(dbPath);

  db.exec(`
    CREATE TABLE session (
      id text PRIMARY KEY,
      project_id text NOT NULL,
      slug text NOT NULL DEFAULT 's',
      directory text NOT NULL,
      title text NOT NULL,
      version text NOT NULL,
      agent text,
      model text,
      cost real DEFAULT 0 NOT NULL,
      tokens_input integer DEFAULT 0 NOT NULL,
      tokens_output integer DEFAULT 0 NOT NULL,
      tokens_reasoning integer DEFAULT 0 NOT NULL,
      tokens_cache_read integer DEFAULT 0 NOT NULL,
      tokens_cache_write integer DEFAULT 0 NOT NULL,
      time_created integer NOT NULL,
      time_updated integer NOT NULL,
      time_archived integer
    );
    CREATE TABLE message (
      id text PRIMARY KEY,
      session_id text NOT NULL,
      time_created integer NOT NULL,
      time_updated integer NOT NULL,
      data text NOT NULL
    );
    CREATE TABLE part (
      id text PRIMARY KEY,
      message_id text NOT NULL,
      session_id text NOT NULL,
      time_created integer NOT NULL,
      time_updated integer NOT NULL,
      data text NOT NULL
    );
  `);

  const sessionId = "ses_fixture1";
  const t0 = 1_785_856_867_808;
  const t1 = 1_785_856_870_000;
  const t2 = 1_785_856_878_892;

  db.query(
    `INSERT INTO session (
       id, project_id, directory, title, version, agent, model, cost,
       tokens_input, tokens_output, tokens_cache_read,
       time_created, time_updated
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    sessionId,
    "proj1",
    "/home/ben/Dev/mission-control",
    "OpenCode fixture session",
    "1.18.13",
    "build",
    JSON.stringify({
      id: "Qwen3.6-35B-A3B-Opencode-128K",
      providerID: "llamaswap",
    }),
    0,
    2469,
    46,
    28971,
    t0,
    t2,
  );

  db.query(
    `INSERT INTO message (id, session_id, time_created, time_updated, data)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    "msg_user",
    sessionId,
    t0,
    t0,
    JSON.stringify({
      role: "user",
      time: { created: t0 },
      agent: "build",
    }),
  );

  db.query(
    `INSERT INTO message (id, session_id, time_created, time_updated, data)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    "msg_asst",
    sessionId,
    t1,
    t2,
    JSON.stringify({
      role: "assistant",
      agent: "build",
      modelID: "Qwen3.6-35B-A3B-Opencode-128K",
      providerID: "llamaswap",
      cost: 0,
      finish: "stop",
      tokens: {
        total: 31486,
        input: 2469,
        output: 46,
        cache: { read: 28971, write: 0 },
      },
      time: { created: t1, completed: t2 },
    }),
  );

  db.query(
    `INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    "prt_text",
    "msg_user",
    sessionId,
    t0,
    t0,
    JSON.stringify({ type: "text", text: "Collect OpenCode activity" }),
  );

  db.query(
    `INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    "prt_tool",
    "msg_asst",
    sessionId,
    t1,
    t1 + 50,
    JSON.stringify({
      type: "tool",
      tool: "read",
      callID: "call-1",
      state: {
        status: "completed",
        title: "Read file",
        input: { path: "src/collector-main.ts" },
        output: "ok",
        time: { start: t1, end: t1 + 50 },
      },
    }),
  );

  db.query(
    `INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    "prt_err",
    "msg_asst",
    sessionId,
    t1 + 100,
    t1 + 200,
    JSON.stringify({
      type: "tool",
      tool: "bash",
      callID: "call-2",
      state: {
        status: "error",
        error: "command failed",
        time: { start: t1 + 100, end: t1 + 200 },
      },
    }),
  );

  db.close();
  return dbPath;
}

describe("OpenCodeCollector", () => {
  test("reports off when opencode.db is missing", async () => {
    const missing = path.join(
      os.tmpdir(),
      `mc-opencode-missing-${Date.now()}.db`,
    );
    const state = new MemoryState();
    const collector = new OpenCodeCollector(state, missing);
    const sink = new CapturingSink();

    const result = await collector.tick(sink);

    expect(result).toEqual({
      eventsEmitted: 0,
      sourceStatus: "off",
      detail: "no opencode.db found",
    });
    expect(sink.batches).toHaveLength(0);
    expect(state.persisted).toBe(false);
  });

  test("reports off when the database has no sessions", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-opencode-empty-"));
    const dbPath = path.join(dir, "opencode.db");
    try {
      const db = new Database(dbPath);
      db.exec(
        `CREATE TABLE session (
           id text PRIMARY KEY,
           directory text, title text, version text,
           time_created integer, time_updated integer
         );`,
      );
      db.close();

      const state = new MemoryState();
      const collector = new OpenCodeCollector(state, dbPath);
      const sink = new CapturingSink();
      const result = await collector.tick(sink);

      expect(result.sourceStatus).toBe("off");
      expect(result.detail).toContain("no sessions");
      expect(sink.batches).toHaveLength(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("emits tool activities, messages, and a session on a tick", async () => {
    const dbPath = createFixtureDb();
    const dir = path.dirname(dbPath);
    try {
      const state = new MemoryState();
      const collector = new OpenCodeCollector(state, dbPath);
      const sink = new CapturingSink();

      const result = await collector.tick(sink);

      expect(result.sourceStatus).toBe("ok");
      expect(result.eventsEmitted).toBeGreaterThan(0);
      expect(sink.batches).toHaveLength(1);

      const batch = sink.batches[0]!;
      expect(batch.sourceId).toBe("opencode");
      expect(batch.instanceId).toBe("opencode@arch-desktop");

      const kinds = batch.events.map((e) => e.kind);
      expect(kinds).toContain("session");
      expect(kinds).toContain("activity");

      const toolCalls = batch.events.filter(
        (e) =>
          e.kind === "activity" &&
          (e.payload as { actionType?: string }).actionType === "tool_call",
      );
      expect(toolCalls.length).toBe(2);

      const failures = toolCalls.filter(
        (e) => (e.payload as { status?: string }).status === "failure",
      );
      expect(failures).toHaveLength(1);

      const session = batch.events.find((e) => e.kind === "session");
      expect(session!.payload).toMatchObject({
        externalId: "ses_fixture1",
        title: "OpenCode fixture session",
        cwd: "/home/ben/Dev/mission-control",
        turnCount: 1,
        toolCallCount: 2,
        failureCount: 1,
        inputTokens: 2469,
        outputTokens: 46,
      });

      expect(state.persisted).toBe(true);

      // Second tick with no new data should emit nothing.
      const sink2 = new CapturingSink();
      const result2 = await collector.tick(sink2);
      expect(result2).toEqual({ eventsEmitted: 0, sourceStatus: "ok" });
      expect(sink2.batches).toHaveLength(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
