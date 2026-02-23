/**
 * Cost Linker Tests
 * Verifies cost linking logic between LLM generations and activities
 */

import { Database } from "../../db/database.js";
import { CostLinker, LinkResult } from "../../services/cost-linker.js";
import * as fs from "fs";

const TEST_DB_PATH = "./test-data/test-linker.db";

describe("CostLinker", () => {
  let db: Database;
  let linker: CostLinker;

  beforeAll(async () => {
    if (!fs.existsSync("./test-data")) {
      fs.mkdirSync("./test-data", { recursive: true });
    }

    db = new Database(TEST_DB_PATH);
    await db.initialize();
  });

  afterAll(async () => {
    await db.close();
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

  beforeEach(async () => {
    await db.clear();
  });

  describe("Linker Initialization", () => {
    test("should create linker", () => {
      linker = new CostLinker(db);
      expect(linker).toBeTruthy();
    });
  });

  describe("Generation to Activity Linking", () => {
    test("should link generation to matching activity", async () => {
      // Create an activity
      const activity = await db.createActivity({
        sessionId: "test-session-001",
        actor: { type: "subagent", id: "engineer" },
        actionType: "decision",
        description: "Test activity",
        timestamp: "2024-01-15T10:30:00Z",
      });

      // Create a generation with matching agent and timestamp
      await db.upsertGeneration({
        id: "gen-001",
        sessionLogFile:
          "/home/user/.openclaw-team/agents/engineer/sessions/test-session-001.jsonl",
        sessionLogMsgId: "msg-001",
        agentId: "engineer",
        timestamp: "2024-01-15T10:30:00Z",
        model: "openrouter/anthropic/claude-haiku-4.5",
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 150,
        costInput: 0.00025,
        costOutput: 0.000625,
        costCacheRead: 0,
        costTotal: 0.000875,
      });

      linker = new CostLinker(db);
      const result = await linker.link();

      expect(result.linked).toBe(1);
      expect(result.activitiesUpdated).toBe(1);
      expect(result.totalCostAttributed).toBeGreaterThan(0);
    });

    test("should not link when no matching activity", async () => {
      // Create a generation without any matching activity
      await db.upsertGeneration({
        id: "gen-002",
        sessionLogFile:
          "/home/user/.openclaw-team/agents/engineer/sessions/unknown-session.jsonl",
        sessionLogMsgId: "msg-002",
        agentId: "unknown-agent",
        timestamp: "2024-01-15T10:30:00Z",
        model: "openrouter/anthropic/claude-haiku-4.5",
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 150,
        costInput: 0.00025,
        costOutput: 0.000625,
        costCacheRead: 0,
        costTotal: 0.000875,
      });

      linker = new CostLinker(db);
      const result = await linker.link();

      expect(result.linked).toBe(0);
      expect(result.activitiesUpdated).toBe(0);
    });

    test("should link by timestamp proximity", async () => {
      // Create activity
      const activity = await db.createActivity({
        sessionId: "test-session",
        actor: { type: "subagent", id: "engineer" },
        actionType: "api_call",
        description: "Test timestamp matching",
        timestamp: "2024-01-15T10:30:00Z",
      });

      // Create generation within 60 second window
      await db.upsertGeneration({
        id: "gen-004",
        sessionLogFile: "/path/to/session.jsonl",
        sessionLogMsgId: "msg-004",
        agentId: "engineer",
        timestamp: "2024-01-15T10:30:30Z", // 30 seconds later
        model: "openrouter/anthropic/claude-haiku-4.5",
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 150,
        costInput: 0.00025,
        costOutput: 0.000625,
        costCacheRead: 0,
        costTotal: 0.000875,
      });

      linker = new CostLinker(db);
      const result = await linker.link();

      expect(result.linked).toBe(1);
    });
  });

  describe("Multiple Generations per Activity", () => {
    test("should aggregate multiple generations for same activity", async () => {
      // Create activity
      const activity = await db.createActivity({
        sessionId: "test-session",
        actor: { type: "subagent", id: "engineer" },
        actionType: "decision",
        description: "Multi-gen activity",
        timestamp: "2024-01-15T10:30:00Z",
      });

      // Create two generations
      await db.upsertGeneration({
        id: "gen-006a",
        sessionLogFile: "/path/to/session.jsonl",
        sessionLogMsgId: "msg-006a",
        agentId: "engineer",
        timestamp: "2024-01-15T10:30:00Z",
        model: "openrouter/anthropic/claude-haiku-4.5",
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 150,
        costInput: 0.00025,
        costOutput: 0.000625,
        costCacheRead: 0,
        costTotal: 0.000875,
      });

      await db.upsertGeneration({
        id: "gen-006b",
        sessionLogFile: "/path/to/session.jsonl",
        sessionLogMsgId: "msg-006b",
        agentId: "engineer",
        timestamp: "2024-01-15T10:30:05Z",
        model: "openrouter/anthropic/claude-haiku-4.5",
        inputTokens: 200,
        outputTokens: 100,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 300,
        costInput: 0.0005,
        costOutput: 0.00125,
        costCacheRead: 0,
        costTotal: 0.00175,
      });

      linker = new CostLinker(db);
      const result = await linker.link();

      expect(result.linked).toBe(2);
      expect(result.activitiesUpdated).toBe(1);
      expect(result.totalCostAttributed).toBeCloseTo(0.002625, 5);
    });
  });

  describe("Cost Aggregation", () => {
    test("should update activity with total cost and tokens", async () => {
      // Create activity
      const activity = await db.createActivity({
        sessionId: "test-session",
        actor: { type: "subagent", id: "engineer" },
        actionType: "api_call",
        description: "Cost aggregation test",
        timestamp: "2024-01-15T10:30:00Z",
      });

      // Create generation
      await db.upsertGeneration({
        id: "gen-007",
        sessionLogFile: "/path/to/session.jsonl",
        sessionLogMsgId: "msg-007",
        agentId: "engineer",
        timestamp: "2024-01-15T10:30:00Z",
        model: "openrouter/anthropic/claude-haiku-4.5",
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 150,
        costInput: 0.00025,
        costOutput: 0.000625,
        costCacheRead: 0,
        costTotal: 0.000875,
      });

      linker = new CostLinker(db);
      await linker.link();

      // Verify activity was updated
      const updatedActivity = await db.getActivity(activity.id);
      expect(updatedActivity?.cost?.usd).toBe(0.000875);
      expect(updatedActivity?.tokens?.inputTokens).toBe(100);
      expect(updatedActivity?.tokens?.outputTokens).toBe(50);
      expect(updatedActivity?.tokens?.totalTokens).toBe(150);
      expect(updatedActivity?.tokens?.model).toBe(
        "openrouter/anthropic/claude-haiku-4.5",
      );
    });
  });
});
