/**
 * Tests for extractActorFromSessionId and actors_json population
 */

import { Database, extractActorFromSessionId } from "../../db/database.js";
import * as fs from "fs";

describe("extractActorFromSessionId", () => {
  test("extracts actor from agent:main:cron:uuid pattern", () => {
    expect(extractActorFromSessionId("agent:main:cron:abc123")).toBe("main");
  });

  test("extracts actor from agent:main:uuid pattern", () => {
    expect(extractActorFromSessionId("agent:main:def456")).toBe("main");
  });

  test("extracts actor from agent:custom-name:type:uuid pattern", () => {
    expect(extractActorFromSessionId("agent:my-agent:task:xyz789")).toBe(
      "my-agent",
    );
  });

  test("returns null for non-matching pattern", () => {
    expect(extractActorFromSessionId("session-12345")).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(extractActorFromSessionId("")).toBeNull();
  });

  test("returns null for agent: prefix without colon-delimited id", () => {
    expect(extractActorFromSessionId("agent")).toBeNull();
  });
});

describe("actors_json population", () => {
  const TEST_DB_PATH = "./test-data/test-extract-actor.db";
  let db: Database;

  beforeAll(async () => {
    if (!fs.existsSync("./test-data")) {
      fs.mkdirSync("./test-data", { recursive: true });
    }
  });

  beforeEach(async () => {
    db = new Database(TEST_DB_PATH);
    await db.initialize();
    await db.clear();
  });

  afterEach(async () => {
    await db.close();
  });

  afterAll(() => {
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

  test("createActivity auto-creates session stub with actors_json", async () => {
    await db.createActivity({
      sessionId: "agent:main:cron:abc123",
      actor: { type: "orchestrator", id: "main" },
      actionType: "tool_call",
      description: "Test",
    });

    const { sessions } = await db.getSessions();
    expect(sessions).toHaveLength(1);
    const actors = JSON.parse(sessions[0].actors_json);
    expect(actors.main).toEqual({
      id: "main",
      type: "orchestrator",
      actionsCount: 0,
      successCount: 0,
      tokensUsed: 0,
      costUsd: 0,
    });
  });

  test("createSession populates actors_json for agent session IDs", async () => {
    await db.createSession("agent:worker:task:xyz789");

    const { sessions } = await db.getSessions();
    expect(sessions).toHaveLength(1);
    const actors = JSON.parse(sessions[0].actors_json);
    expect(actors.worker).toEqual({
      id: "worker",
      type: "orchestrator",
      actionsCount: 0,
      successCount: 0,
      tokensUsed: 0,
      costUsd: 0,
    });
  });

  test("createSession leaves actors_json null for non-agent session IDs", async () => {
    await db.createSession("session-12345");

    const { sessions } = await db.getSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].actors_json).toBeNull();
  });
});
