import { describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { Database } from "bun:sqlite";
import { DevinCollector } from "../../../collectors/devin/collector.js";
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

function createFixtureDb(): { dir: string; dbPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-devin-"));
  const dbPath = path.join(dir, "sessions.db");
  const db = new Database(dbPath);

  db.exec(`
    CREATE TABLE sessions (
      id text PRIMARY KEY,
      working_directory text NOT NULL,
      backend_type text NOT NULL,
      model text NOT NULL,
      agent_mode text NOT NULL,
      created_at integer NOT NULL,
      last_activity_at integer NOT NULL,
      title text,
      metadata text,
      hidden integer NOT NULL DEFAULT 0
    );
    CREATE TABLE message_nodes (
      row_id integer PRIMARY KEY AUTOINCREMENT,
      session_id text NOT NULL,
      node_id integer NOT NULL,
      parent_node_id integer,
      chat_message text NOT NULL,
      created_at integer NOT NULL,
      metadata text
    );
    CREATE TABLE tool_call_state (
      session_id text NOT NULL,
      tool_call_id text NOT NULL,
      tool_call_json text,
      tool_call_update_json text,
      PRIMARY KEY (session_id, tool_call_id)
    );
  `);

  const sessionId = "devin-fixture-1";
  const t0 = 1_789_622_500;
  const t1 = 1_789_622_900;

  db.query(
    `INSERT INTO sessions (
       id, working_directory, backend_type, model, agent_mode,
       created_at, last_activity_at, title, metadata
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    sessionId,
    "/home/ben/Dev/mission-control",
    "windsurf",
    "swe-2-high",
    "normal",
    t0,
    t1,
    "Devin fixture session",
    JSON.stringify({ total_acu_cost: 1.25, total_credit_cost: 0 }),
  );

  const insertNode = db.query(
    `INSERT INTO message_nodes (session_id, node_id, parent_node_id, chat_message, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  );

  insertNode.run(
    sessionId,
    1,
    null,
    JSON.stringify({
      message_id: "m-user",
      role: "user",
      content: "track devin usage",
    }),
    t0 + 5,
  );
  insertNode.run(
    sessionId,
    2,
    1,
    JSON.stringify({
      message_id: "m-asst",
      role: "assistant",
      content: "Working on it.",
      tool_calls: [{ id: "exec_1#aa", name: "exec", index: 0 }],
    }),
    t0 + 10,
  );
  insertNode.run(
    sessionId,
    3,
    2,
    JSON.stringify({
      message_id: "m-tool",
      role: "tool",
      tool_call_id: "exec_1#aa",
      content: "ok",
      metadata: {
        extensions: {
          "chisel/tool_result_meta": { success: true },
        },
      },
    }),
    t0 + 12,
  );

  db.query(
    `INSERT INTO tool_call_state (session_id, tool_call_id, tool_call_json)
     VALUES (?, ?, ?)`,
  ).run(sessionId, "exec_1#aa", JSON.stringify({ function: { name: "exec" } }));

  db.close();
  return { dir, dbPath };
}

function makeCollector(
  dbPath: string,
  sink: CapturingSink,
  state: MemoryState,
) {
  // credentialsPath points at a nonexistent file so the plan-usage poll
  // short-circuits to [] without touching the network.
  return new DevinCollector(
    state as never,
    dbPath,
    path.join(os.tmpdir(), "mc-devin-no-creds.toml"),
  );
}

describe("DevinCollector", () => {
  test("emits a session event with no fabricated tokens/USD", async () => {
    const { dbPath } = createFixtureDb();
    const sink = new CapturingSink();
    const state = new MemoryState();
    const collector = makeCollector(dbPath, sink, state);

    const result = await collector.tick(sink);

    expect(result.sourceStatus).toBe("ok");
    expect(sink.batches.length).toBeGreaterThan(0);
    const session = sink.batches
      .flatMap((b) => b.events)
      .find((e) => e.kind === "session");
    expect(session).toBeDefined();
    const p = session?.payload as Record<string, unknown>;
    expect(p.externalId).toBe("devin-fixture-1");
    expect(p.modelProvider).toBe("devin");
    expect(p.title).toBe("Devin fixture session");
    expect(p.toolCallCount).toBe(1);
    expect(p.turnCount).toBe(1);
    expect(p.costUsd).toBeUndefined();
    expect(p.inputTokens).toBeUndefined();
    expect(state.persisted).toBe(true);
  });

  test("emits activity events for user/assistant/tool nodes plus ACU meta", async () => {
    const { dbPath } = createFixtureDb();
    const sink = new CapturingSink();
    const collector = makeCollector(dbPath, sink, new MemoryState());

    await collector.tick(sink);

    const activities = sink.batches
      .flatMap((b) => b.events)
      .filter((e) => e.kind === "activity");
    const actionTypes = activities.map(
      (e) => (e.payload as Record<string, unknown>).actionType,
    );
    expect(actionTypes).toContain("user_request");
    expect(actionTypes).toContain("message");
    expect(actionTypes).toContain("tool_call");

    const meta = activities.find(
      (e) => (e.payload as Record<string, unknown>).actionType === "event",
    );
    const details = (meta?.payload as Record<string, unknown>)?.details as
      | Record<string, unknown>
      | undefined;
    expect(details?.totalAcuCost).toBe(1.25);
  });

  test("second tick emits no duplicates (cursor advance)", async () => {
    const { dbPath } = createFixtureDb();
    const sink = new CapturingSink();
    const state = new MemoryState();
    const collector = makeCollector(dbPath, sink, state);

    await collector.tick(sink);
    const firstCount = sink.batches.flatMap((b) => b.events).length;
    expect(firstCount).toBeGreaterThan(0);

    sink.batches = [];
    const result = await collector.tick(sink);
    expect(sink.batches.flatMap((b) => b.events).length).toBe(0);
    expect(result.eventsEmitted).toBe(0);
  });

  test("missing database returns sourceStatus off", async () => {
    const sink = new CapturingSink();
    const state = new MemoryState();
    const collector = makeCollector("/nonexistent/sessions.db", sink, state);

    const result = await collector.tick(sink);
    expect(result.sourceStatus).toBe("off");
    expect(sink.batches.length).toBe(0);
    expect(state.persisted).toBe(false);
  });
});
