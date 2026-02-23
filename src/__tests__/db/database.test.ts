/**
 * Database Tests
 * Verifies database operations using in-memory SQLite
 */

import { Database } from "../../db/database.js";
import {
  Activity,
  CreateActivityInput,
  ActivityFilter,
} from "../../types/activity.js";
import * as fs from "fs";

const TEST_DB_PATH = "./test-data/test-database.db";

describe("Database", () => {
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

  describe("createActivity", () => {
    test("should create activity with minimal fields", async () => {
      const input: CreateActivityInput = {
        sessionId: "test-session",
        actor: { type: "subagent", id: "agent-1" },
        actionType: "tool_call",
        description: "Test activity",
      };

      const activity = await db.createActivity(input);

      expect(activity).toBeTruthy();
      expect(activity.id).toBeTruthy();
      expect(activity.sessionId).toBe("test-session");
      expect(activity.actor.id).toBe("agent-1");
      expect(activity.actionType).toBe("tool_call");
      expect(activity.status).toBe("pending");
    });

    test("should create activity with all fields", async () => {
      const input: CreateActivityInput = {
        sessionId: "test-session",
        parentActivityId: "parent-123",
        actor: { type: "orchestrator", id: "main", role: "Orchestrator" },
        actionType: "decision",
        toolName: "web_search",
        description: "Full test activity",
        details: { query: "test" },
        status: "success",
        tags: ["test", "api"],
      };

      const activity = await db.createActivity(input);

      expect(activity.parentActivityId).toBe("parent-123");
      expect(activity.actor.role).toBe("Orchestrator");
      expect(activity.toolName).toBe("web_search");
    });

    test("should generate unique IDs", async () => {
      const input: CreateActivityInput = {
        sessionId: "test-session",
        actor: { type: "subagent", id: "agent-1" },
        actionType: "tool_call",
        description: "Test",
      };

      const activity1 = await db.createActivity(input);
      const activity2 = await db.createActivity(input);

      expect(activity1.id).not.toBe(activity2.id);
    });
  });

  describe("getActivities", () => {
    test("should filter by sessionId", async () => {
      await db.createActivity({
        sessionId: "session-1",
        actor: { type: "subagent", id: "agent-1" },
        actionType: "tool_call",
        description: "Activity 1",
      });
      await db.createActivity({
        sessionId: "session-2",
        actor: { type: "subagent", id: "agent-2" },
        actionType: "tool_call",
        description: "Activity 2",
      });

      const activities = await db.getActivities({ sessionId: "session-1" });

      expect(activities.length).toBe(1);
      expect(activities[0].sessionId).toBe("session-1");
    });

    test("should filter by actorId", async () => {
      await db.createActivity({
        sessionId: "test-session",
        actor: { type: "subagent", id: "agent-1" },
        actionType: "tool_call",
        description: "Activity 1",
      });
      await db.createActivity({
        sessionId: "test-session",
        actor: { type: "subagent", id: "agent-2" },
        actionType: "tool_call",
        description: "Activity 2",
      });

      const activities = await db.getActivities({ actorId: "agent-1" });

      expect(activities.length).toBe(1);
      expect(activities[0].actor.id).toBe("agent-1");
    });

    test("should respect limit", async () => {
      for (let i = 0; i < 5; i++) {
        await db.createActivity({
          sessionId: `session-${i}`,
          actor: { type: "subagent", id: "agent-1" },
          actionType: "tool_call",
          description: `Activity ${i}`,
        });
      }

      const activities = await db.getActivities({ limit: 3 });

      expect(activities.length).toBe(3);
    });

    test("should respect offset", async () => {
      for (let i = 0; i < 5; i++) {
        await db.createActivity({
          sessionId: `session-${i}`,
          actor: { type: "subagent", id: "agent-1" },
          actionType: "tool_call",
          description: `Activity ${i}`,
        });
      }

      const activities = await db.getActivities({ limit: 5, offset: 2 });

      expect(activities.length).toBe(3);
    });
  });

  describe("updateActivity", () => {
    test("should update status", async () => {
      const activity = await db.createActivity({
        sessionId: "test-session",
        actor: { type: "subagent", id: "agent-1" },
        actionType: "tool_call",
        description: "Test",
      });

      await db.updateActivity(activity.id, { status: "success" });

      const updated = await db.getActivity(activity.id);
      expect(updated?.status).toBe("success");
    });

    test("should update cost and tokens", async () => {
      const activity = await db.createActivity({
        sessionId: "test-session",
        actor: { type: "subagent", id: "agent-1" },
        actionType: "tool_call",
        description: "Test",
      });

      await db.updateActivity(activity.id, {
        cost: { usd: 0.0025 },
        tokens: {
          inputTokens: 1000,
          outputTokens: 500,
          totalTokens: 1500,
          model: "openrouter/anthropic/claude-haiku-4.5",
        },
      });

      const updated = await db.getActivity(activity.id);
      expect(updated?.cost?.usd).toBe(0.0025);
      expect(updated?.tokens?.totalTokens).toBe(1500);
    });
  });

  describe("Session Operations", () => {
    test("should create session", async () => {
      await db.createSession("test-session");

      const summary = await db.getSessionSummary("test-session");
      expect(summary).toBeTruthy();
      expect(summary?.sessionId).toBe("test-session");
    });
  });

  describe("Generation Operations", () => {
    test("should upsert generation", async () => {
      await db.upsertGeneration({
        id: "gen-001",
        sessionLogFile: "/path/to/session.jsonl",
        sessionLogMsgId: "msg-001",
        agentId: "agent-1",
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

      const generations = await db.getGenerations();
      expect(generations.length).toBe(1);
      expect(generations[0].agent_id).toBe("agent-1");
    });

    test("should link generation to activity", async () => {
      const activity = await db.createActivity({
        sessionId: "test-session",
        actor: { type: "subagent", id: "agent-1" },
        actionType: "tool_call",
        description: "Test",
      });

      await db.upsertGeneration({
        id: "gen-002",
        sessionLogFile: "/path/to/session.jsonl",
        sessionLogMsgId: "msg-002",
        agentId: "agent-1",
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

      await db.linkGeneration("gen-002", activity.id);

      const generations = await db.getGenerations();
      expect(generations[0].linked_activity_id).toBe(activity.id);
    });
  });

  describe("Stats", () => {
    test("should return database stats", async () => {
      await db.createActivity({
        sessionId: "test-session",
        actor: { type: "subagent", id: "agent-1" },
        actionType: "tool_call",
        description: "Test",
      });

      await db.createSession("test-session");

      const stats = await db.getStats();
      expect(stats.activities).toBe(1);
      expect(stats.sessions).toBe(1);
    });
  });
});
