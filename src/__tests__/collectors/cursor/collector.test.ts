import { describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { Database } from "bun:sqlite";
import { CursorCollector } from "../../../collectors/cursor/collector.js";
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

const T0 = 1_784_278_800_000;

function createVscdb(dir: string): string {
  const dbPath = path.join(dir, "state.vscdb");
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE ItemTable (key TEXT UNIQUE, value BLOB);
    CREATE TABLE cursorDiskKV (key TEXT UNIQUE, value BLOB);
  `);
  return dbPath;
}

function insertKv(dbPath: string, key: string, value: unknown) {
  const db = new Database(dbPath);
  db.query(`INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)`).run(
    key,
    typeof value === "string" ? value : JSON.stringify(value),
  );
  db.close();
}

/** Fixture vscdb with one composer, a user bubble, an assistant bubble, and
 *  one toolFormerData row (plus noise keys that must be skipped). */
function createGlobalFixture(): { dir: string; dbPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-cursor-global-"));
  const dbPath = createVscdb(dir);
  const db = new Database(dbPath);

  const rows: Array<[string, unknown]> = [
    [
      "composerData:comp-1",
      {
        composerId: "comp-1",
        name: "Cursor fixture session",
        createdAt: T0,
        lastUpdatedAt: T0 + 5_000,
        status: "completed",
        unifiedMode: "agent",
      },
    ],
    [
      "bubbleId:comp-1:b-1",
      { type: 1, text: "Collect Cursor activity", createdAt: T0 + 1_000 },
    ],
    [
      "bubbleId:comp-1:b-2",
      {
        type: 2,
        text: "On it.",
        createdAt: T0 + 2_000,
        modelInfo: { modelName: "gpt-5" },
      },
    ],
    [
      "toolFormerData:comp-1:call-1",
      { name: "read_file", status: "completed", params: { path: "a.ts" } },
    ],
    [
      "toolFormerData:comp-1:call-2",
      { name: "bash", status: "error", error: "boom" },
    ],
    // noise that must be skipped
    ["checkpointId:comp-1:cp-1", { files: [] }],
    ["agentKv:req-1", "{not-json?"],
    ["bubbleId:comp-1:b-bad", "{malformed"],
  ];
  for (const [key, value] of rows) {
    db.query(`INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)`).run(
      key,
      typeof value === "string" ? value : JSON.stringify(value),
    );
  }
  db.close();
  return { dir, dbPath };
}

/** Fixture ~/.cursor/chats/<md5>/<uuid>/store.db + meta.json. */
function createCliFixture(root: string): {
  chatsDir: string;
  sessionId: string;
} {
  const bucket = "0123456789abcdef0123456789abcdef";
  const sessionId = "11111111-2222-3333-4444-555555555555";
  const sessionDir = path.join(root, "chats", bucket, sessionId);
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(
    path.join(sessionDir, "meta.json"),
    JSON.stringify({
      title: "CLI session fixture",
      createdAtMs: T0,
      updatedAtMs: T0 + 60_000,
    }),
  );
  fs.writeFileSync(
    path.join(sessionDir, "prompt_history.json"),
    JSON.stringify(["Collect Cursor activity"]),
  );

  const db = new Database(path.join(sessionDir, "store.db"));
  db.exec(`
    CREATE TABLE blobs (id TEXT PRIMARY KEY, data BLOB);
    CREATE TABLE meta (key TEXT UNIQUE, value BLOB);
  `);
  db.query(`INSERT INTO blobs (id, data) VALUES (?, ?)`).run(
    "blob-user",
    JSON.stringify({
      role: "user",
      text: "Collect Cursor activity",
      timestamp: T0,
    }),
  );
  db.query(`INSERT INTO blobs (id, data) VALUES (?, ?)`).run(
    "blob-asst",
    JSON.stringify({ role: "assistant", text: "Done", timestamp: T0 + 1_000 }),
  );
  // protobuf-ish blob — must be skipped
  db.query(`INSERT INTO blobs (id, data) VALUES (?, ?)`).run(
    "blob-proto",
    Buffer.from([0x0a, 0x05, 0x12, 0x03]),
  );
  db.close();

  return { chatsDir: path.join(root, "chats"), sessionId };
}

function missingPaths(dir: string) {
  return {
    globalDbPath: path.join(dir, "nope", "state.vscdb"),
    chatsDir: path.join(dir, "nope", "chats"),
    workspaceStorageDir: path.join(dir, "nope", "workspaceStorage"),
  };
}

describe("CursorCollector", () => {
  test("reports off when no Cursor data exists", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-cursor-empty-"));
    try {
      const state = new MemoryState();
      const collector = new CursorCollector(state, missingPaths(dir));
      const sink = new CapturingSink();

      const result = await collector.tick(sink);

      expect(result.sourceStatus).toBe("off");
      expect(result.detail).toContain("no Cursor data");
      expect(sink.batches).toHaveLength(0);
      expect(state.persisted).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("reports off when state.vscdb has no composer rows", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-cursor-emptydb-"));
    try {
      const dbPath = createVscdb(dir);
      const state = new MemoryState();
      const collector = new CursorCollector(state, {
        globalDbPath: dbPath,
        chatsDir: path.join(dir, "no-chats"),
        workspaceStorageDir: path.join(dir, "no-ws"),
      });
      const sink = new CapturingSink();

      const result = await collector.tick(sink);

      expect(result.sourceStatus).toBe("off");
      expect(result.detail).toContain("no Cursor sessions");
      expect(sink.batches).toHaveLength(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("emits session + activities from state.vscdb, then goes quiet", async () => {
    const { dir, dbPath } = createGlobalFixture();
    try {
      const state = new MemoryState();
      const collector = new CursorCollector(state, {
        globalDbPath: dbPath,
        chatsDir: path.join(dir, "no-chats"),
        workspaceStorageDir: path.join(dir, "no-ws"),
      });
      const sink = new CapturingSink();

      const result = await collector.tick(sink);

      expect(result.sourceStatus).toBe("ok");
      expect(sink.batches).toHaveLength(1);
      const batch = sink.batches[0]!;
      expect(batch.sourceId).toBe("cursor");
      expect(batch.instanceId).toBe("cursor@arch-desktop");

      const session = batch.events.find((e) => e.kind === "session");
      expect(session!.payload).toMatchObject({
        externalId: "comp-1",
        title: "Cursor fixture session",
        turnCount: 1,
        toolCallCount: 2,
        failureCount: 1,
      });

      const activities = batch.events.filter((e) => e.kind === "activity");
      const actionTypes = activities.map(
        (e) => (e.payload as { actionType?: string }).actionType,
      );
      expect(actionTypes).toContain("user_request");
      expect(actionTypes).toContain("message");
      expect(actionTypes.filter((t) => t === "tool_call")).toHaveLength(2);
      const failures = activities.filter(
        (e) => (e.payload as { status?: string }).status === "failure",
      );
      expect(failures).toHaveLength(1);
      expect(state.persisted).toBe(true);

      // Second tick: nothing new.
      const sink2 = new CapturingSink();
      const result2 = await collector.tick(sink2);
      expect(result2).toEqual({ eventsEmitted: 0, sourceStatus: "ok" });
      expect(sink2.batches).toHaveLength(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("incrementally emits only new cursorDiskKV rows", async () => {
    const { dir, dbPath } = createGlobalFixture();
    try {
      const state = new MemoryState();
      const collector = new CursorCollector(state, {
        globalDbPath: dbPath,
        chatsDir: path.join(dir, "no-chats"),
        workspaceStorageDir: path.join(dir, "no-ws"),
      });
      await collector.tick(new CapturingSink());

      // New bubble + a composerData update in place (UPDATE keeps rowid;
      // the per-tick composer rescan still catches lastUpdatedAt).
      insertKv(dbPath, "bubbleId:comp-1:b-4", {
        type: 1,
        text: "follow up",
        createdAt: T0 + 9_000,
      });
      const db = new Database(dbPath);
      db.query(
        `UPDATE cursorDiskKV SET value = ? WHERE key = 'composerData:comp-1'`,
      ).run(
        JSON.stringify({
          composerId: "comp-1",
          name: "Cursor fixture session",
          createdAt: T0,
          lastUpdatedAt: T0 + 10_000,
          status: "completed",
        }),
      );
      db.close();

      const sink = new CapturingSink();
      const result = await collector.tick(sink);
      expect(result.sourceStatus).toBe("ok");
      const events = sink.batches.flatMap((b) => b.events);
      const newBubble = events.find(
        (e) => e.naturalKey === "cursor:bubble:comp-1:b-4",
      );
      expect(newBubble).toBeDefined();
      const session = events.find((e) => e.kind === "session");
      expect((session!.payload as { turnCount?: number }).turnCount).toBe(2);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a failed send does not inflate counts on the next tick", async () => {
    const { dir, dbPath } = createGlobalFixture();
    try {
      const state = new MemoryState();
      const collector = new CursorCollector(state, {
        globalDbPath: dbPath,
        chatsDir: path.join(dir, "no-chats"),
        workspaceStorageDir: path.join(dir, "no-ws"),
      });

      // Tick 1 succeeds so the aggregate exists in the store.
      await collector.tick(new CapturingSink());

      // New activity lands; the composer header bumps lastUpdatedAt.
      insertKv(dbPath, "bubbleId:comp-1:b-5", {
        type: 1,
        text: "second turn",
        createdAt: T0 + 9_000,
      });
      const db = new Database(dbPath);
      db.query(
        `UPDATE cursorDiskKV SET value = ? WHERE key = 'composerData:comp-1'`,
      ).run(
        JSON.stringify({
          composerId: "comp-1",
          createdAt: T0,
          lastUpdatedAt: T0 + 10_000,
          status: "completed",
        }),
      );
      db.close();

      const failingSink: Sink = {
        async send() {
          throw new Error("sink down");
        },
        async heartbeat() {},
      };
      await expect(collector.tick(failingSink)).rejects.toThrow("sink down");

      // Next tick re-scans the same rows — counts must not double.
      const sink = new CapturingSink();
      const result = await collector.tick(sink);
      expect(result.sourceStatus).toBe("ok");
      const session = sink.batches
        .flatMap((b) => b.events)
        .find((e) => e.kind === "session");
      expect(session!.payload).toMatchObject({
        externalId: "comp-1",
        turnCount: 2,
        toolCallCount: 2,
        failureCount: 1,
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a restarted collector does not re-emit or duplicate events", async () => {
    const { dir, dbPath } = createGlobalFixture();
    try {
      const state = new MemoryState();
      const first = new CursorCollector(state, {
        globalDbPath: dbPath,
        chatsDir: path.join(dir, "no-chats"),
        workspaceStorageDir: path.join(dir, "no-ws"),
      });
      const sink1 = new CapturingSink();
      await first.tick(sink1);
      const keys1 = sink1.batches.flatMap((b) =>
        b.events.map((e) => e.naturalKey),
      );

      // Fresh collector over the same persisted state.
      const second = new CursorCollector(state, {
        globalDbPath: dbPath,
        chatsDir: path.join(dir, "no-chats"),
        workspaceStorageDir: path.join(dir, "no-ws"),
      });
      const sink2 = new CapturingSink();
      const result = await second.tick(sink2);
      expect(result.eventsEmitted).toBe(0);
      expect(sink2.batches).toHaveLength(0);
      expect(new Set(keys1).size).toBe(keys1.length);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("emits CLI sessions from ~/.cursor/chats store.db + meta.json", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-cursor-cli-"));
    try {
      const { chatsDir, sessionId } = createCliFixture(dir);
      const state = new MemoryState();
      const collector = new CursorCollector(state, {
        globalDbPath: path.join(dir, "nope", "state.vscdb"),
        chatsDir,
        workspaceStorageDir: path.join(dir, "no-ws"),
      });
      const sink = new CapturingSink();

      const result = await collector.tick(sink);

      expect(result.sourceStatus).toBe("ok");
      const events = sink.batches.flatMap((b) => b.events);
      const session = events.find((e) => e.kind === "session");
      expect(session!.payload).toMatchObject({
        externalId: sessionId,
        title: "CLI session fixture",
        turnCount: 1,
      });
      expect(events.some((e) => e.naturalKey.includes("blob-proto"))).toBe(
        false,
      );
      const userReq = events.find(
        (e) =>
          e.kind === "activity" &&
          (e.payload as { actionType?: string }).actionType === "user_request",
      );
      expect(userReq).toBeDefined();

      // Restart-safe: same state, second tick emits nothing.
      const sink2 = new CapturingSink();
      const result2 = await collector.tick(sink2);
      expect(result2).toEqual({ eventsEmitted: 0, sourceStatus: "ok" });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
