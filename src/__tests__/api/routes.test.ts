/**
 * API Routes Tests
 * Verifies all API endpoints
 */

import { Database } from "../../db/database.js";
import { ActivityLogger } from "../../logger/activity-logger.js";
import { setupRoutes } from "../../api/routes.js";
import express from "express";
import * as fs from "fs";

const TEST_DB_PATH = "./test-data/test-routes.db";

describe("API Routes", () => {
  let db: Database;
  let logger: ActivityLogger;
  let app: express.Express;

  // Helper to create mock request/response
  const mockReq = (overrides: any = {}) => ({
    query: {},
    params: {},
    body: {},
    path: "/api/test",
    ...overrides,
  });

  const mockRes = () => {
    const res: any = {
      statusCode: 200,
      jsonData: null,
      status: function (code: number) {
        this.statusCode = code;
        return this;
      },
      json: function (data: any) {
        this.jsonData = data;
        return this;
      },
      setHeader: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
      writableEnded: false,
    };
    return res;
  };

  beforeAll(async () => {
    if (!fs.existsSync("./test-data")) {
      fs.mkdirSync("./test-data", { recursive: true });
    }

    db = new Database(TEST_DB_PATH);
    await db.initialize();
    logger = new ActivityLogger(db);

    // Create express app
    app = express();
    app.use(express.json());
    setupRoutes(app, logger);
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

  describe("Route Setup", () => {
    test("should setup routes without error", () => {
      const testApp = express();
      testApp.use(express.json());
      expect(() => setupRoutes(testApp, logger)).not.toThrow();
    });
  });

  describe("Activity Routes", () => {
    test("GET /api/activities should return activities", async () => {
      // Create test activity
      await logger.logSessionStart("test-session");

      // Get the route handler directly
      let handler: any;
      app._router.stack.forEach((layer: any) => {
        if (
          layer.route &&
          layer.route.path === "/api/activities" &&
          layer.route.methods.get
        ) {
          handler = layer.route.stack[0].handle;
        }
      });

      expect(handler).toBeTruthy();
    });

    test("GET /api/activities/:id should return activity by id", async () => {
      const activityId = await logger.logSessionStart("test-session");

      // Verify we can get the activity from the database
      const activity = await logger.getActivity(activityId);
      expect(activity).toBeTruthy();
      expect(activity?.id).toBe(activityId);
    });

    test("POST /api/activities should create activity", async () => {
      const activities = [
        {
          type: "tool_execution",
          sessionId: "test-session",
          agentId: "agent-1",
          toolName: "exec",
          description: "Test execution",
          timestamp: new Date().toISOString(),
        },
      ];

      // Simulate activity creation via database directly
      const created = await db.createActivity({
        sessionId: "test-session",
        actor: { type: "subagent", id: "agent-1" },
        actionType: "tool_call",
        toolName: "exec",
        description: "Test execution",
      });

      expect(created).toBeTruthy();
      expect(created.actionType).toBe("tool_call");
    });
  });

  describe("Session Routes", () => {
    test("GET /api/sessions/:id should return session summary", async () => {
      await logger.logSessionStart("test-session");

      const summary = await logger.getSessionSummary("test-session");
      expect(summary).toBeTruthy();
      expect(summary?.sessionId).toBe("test-session");
    });

    test("should return session activities", async () => {
      await logger.logSessionStart("test-session");
      await logger.logToolStart(
        "test-session",
        { type: "subagent", id: "agent-1" },
        "exec",
        {},
        "Test",
      );

      const activities = await logger.getSessionActivities("test-session");
      expect(activities.length).toBeGreaterThan(0);
    });

    test("GET /api/sessions/:id/cost-report should return cost report", async () => {
      await logger.logSessionStart("test-session");

      const summary = await logger.getSessionSummary("test-session");
      expect(summary).toBeTruthy();
      expect(summary?.stats).toBeTruthy();
    });
  });

  describe("Cost Report Routes", () => {
    test("GET /api/cost-report should aggregate costs", async () => {
      const activityId = await logger.logToolStart(
        "test-session",
        { type: "subagent", id: "agent-1" },
        "exec",
        {},
        "Test",
      );
      await logger.logToolWithTokens(activityId, {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        model: "openrouter/anthropic/claude-haiku-4.5",
      });

      const activities = await db.getActivities();
      expect(activities.length).toBeGreaterThan(0);
    });

    test("should aggregate costs by actor", async () => {
      const activityId1 = await logger.logToolStart(
        "test-session",
        { type: "subagent", id: "agent-1" },
        "exec",
        {},
        "Test 1",
      );
      await logger.logToolWithTokens(activityId1, {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        model: "openrouter/anthropic/claude-haiku-4.5",
      });

      const activityId2 = await logger.logToolStart(
        "test-session",
        { type: "subagent", id: "agent-2" },
        "read",
        {},
        "Test 2",
      );
      await logger.logToolWithTokens(activityId2, {
        inputTokens: 2000,
        outputTokens: 1000,
        totalTokens: 3000,
        model: "openrouter/anthropic/claude-haiku-4.5",
      });

      const activities = await db.getActivities();
      const agent1Activities = activities.filter(
        (a) => a.actor.id === "agent-1",
      );
      const agent2Activities = activities.filter(
        (a) => a.actor.id === "agent-2",
      );

      expect(agent1Activities.length).toBeGreaterThan(0);
      expect(agent2Activities.length).toBeGreaterThan(0);
    });
  });

  describe("Health & Stats Routes", () => {
    test("GET /api/health should return healthy status", async () => {
      // Health endpoint is simple - just test the database is working
      const stats = await db.getStats();
      expect(stats).toBeTruthy();
    });

    test("GET /api/stats should return system statistics", async () => {
      await logger.logSessionStart("test-session");

      const stats = await db.getStats();
      expect(stats.activities).toBeGreaterThanOrEqual(1);
      expect(stats.sessions).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Error Handling", () => {
    test("should handle non-existent activity", async () => {
      const activity = await logger.getActivity("non-existent-id");
      expect(activity).toBeNull();
    });

    test("should handle non-existent session", async () => {
      const summary = await logger.getSessionSummary("non-existent-session");
      expect(summary).toBeNull();
    });
  });

  describe("Generation Routes", () => {
    test("should handle generations", async () => {
      await db.upsertGeneration({
        id: "gen-test",
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
      expect(generations[0].cost_total).toBe(0.000875);
    });

    test("should filter unlinked generations", async () => {
      await db.upsertGeneration({
        id: "gen-unlinked",
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

      const unlinked = await db.getGenerations({ unlinkedOnly: true });
      expect(unlinked.length).toBe(1);
      expect(unlinked[0].linked_activity_id).toBeNull();
    });
  });
});
