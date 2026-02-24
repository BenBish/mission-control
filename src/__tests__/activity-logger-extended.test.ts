/**
 * Extended Activity Logger Tests
 * Covers logApiCall, logMessage, and edge cases in logToolEnd
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { Database } from "../db/database.js";
import { ActivityLogger } from "../logger/activity-logger.js";
import * as fs from "fs";

const TEST_DB_PATH = "./test-data/test-logger-ext.db";

describe("ActivityLogger Extended", () => {
  let db: Database;
  let logger: ActivityLogger;

  beforeAll(async () => {
    if (!fs.existsSync("./test-data")) {
      fs.mkdirSync("./test-data", { recursive: true });
    }
    db = new Database(TEST_DB_PATH);
    await db.initialize();
    logger = new ActivityLogger(db);
  });

  afterAll(async () => {
    logger.removeAllListeners();
    await db.close();
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

  beforeEach(async () => {
    await db.clear();
  });

  describe("logApiCall", () => {
    test("should log an API call with all fields", async () => {
      const sessionId = "test:api:001";
      await logger.logSessionStart(sessionId);

      const activityId = await logger.logApiCall(
        sessionId,
        { type: "subagent", id: "agent-1" },
        "/api/agents",
        "GET",
        200,
      );

      expect(activityId).toBeTruthy();

      const activity = await logger.getActivity(activityId);
      expect(activity).toBeTruthy();
      expect(activity!.actionType).toBe("api_call");
      expect(activity!.description).toBe("GET /api/agents");
      expect(activity!.details!.endpoint).toBe("/api/agents");
      expect(activity!.details!.method).toBe("GET");
      expect(activity!.details!.statusCode).toBe(200);
      expect(activity!.tags).toContain("api");
    });

    test("should log an API call without status code", async () => {
      const sessionId = "test:api:002";
      await logger.logSessionStart(sessionId);

      const activityId = await logger.logApiCall(
        sessionId,
        { type: "subagent", id: "agent-1" },
        "/api/health",
        "GET",
      );

      const activity = await logger.getActivity(activityId);
      expect(activity!.details!.statusCode).toBeUndefined();
    });
  });

  describe("logMessage", () => {
    test("should log inter-agent message", async () => {
      const sessionId = "test:msg:001";
      await logger.logSessionStart(sessionId);

      const activityId = await logger.logMessage(
        sessionId,
        { type: "subagent", id: "agent-1" },
        "agent-2",
        "Hello, please review the PR",
      );

      expect(activityId).toBeTruthy();

      const activity = await logger.getActivity(activityId);
      expect(activity).toBeTruthy();
      expect(activity!.actionType).toBe("message");
      expect(activity!.description).toContain("agent-2");
      expect(activity!.description).toContain("Hello, please review");
      expect(activity!.details!.target).toBe("agent-2");
      expect(activity!.details!.message).toBe("Hello, please review the PR");
      expect(activity!.tags).toContain("messaging");
    });

    test("should truncate long messages in description", async () => {
      const sessionId = "test:msg:002";
      await logger.logSessionStart(sessionId);

      const longMessage = "A".repeat(200);

      const activityId = await logger.logMessage(
        sessionId,
        { type: "subagent", id: "agent-1" },
        "agent-2",
        longMessage,
      );

      const activity = await logger.getActivity(activityId);
      // Description should be truncated (first 100 chars of message)
      expect(activity!.description.length).toBeLessThan(200);
      // But full message stored in details
      expect(activity!.details!.message).toBe(longMessage);
    });
  });

  describe("logToolEnd edge cases", () => {
    test("should warn and return for non-existent activity ID", async () => {
      // Should not throw, just return silently
      await logger.logToolEnd(
        "non-existent-id",
        "success",
        {},
        "output",
        undefined,
        100,
      );
      // No error thrown = pass
    });

    test("should emit activity:updated event on tool end", async () => {
      const sessionId = "test:update:001";
      await logger.logSessionStart(sessionId);

      const activityId = await logger.logToolStart(
        sessionId,
        { type: "subagent", id: "agent-1" },
        "exec",
        { command: "echo test" },
        "Test execution",
      );

      let updatedActivity: any = null;
      logger.once("activity:updated", (activity) => {
        updatedActivity = activity;
      });

      await logger.logToolEnd(
        activityId,
        "success",
        { exitCode: 0 },
        "test output",
        undefined,
        50,
      );

      // Give event loop a tick
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(updatedActivity).toBeTruthy();
      expect(updatedActivity.id).toBe(activityId);
      expect(updatedActivity.status).toBe("success");
    });

    test("should emit activity:cost event on logToolWithTokens", async () => {
      const sessionId = "test:cost:001";
      await logger.logSessionStart(sessionId);

      const activityId = await logger.logToolStart(
        sessionId,
        { type: "subagent", id: "agent-1" },
        "exec",
        {},
        "Cost test",
      );

      let costEvent: any = null;
      logger.once("activity:cost", (data) => {
        costEvent = data;
      });

      await logger.logToolWithTokens(activityId, {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        model: "openrouter/anthropic/claude-haiku-4.5",
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(costEvent).toBeTruthy();
      expect(costEvent.id).toBe(activityId);
      expect(costEvent.cost).toBeGreaterThan(0);
      expect(costEvent.tokens).toBe(150);
    });
  });

  describe("getDatabase", () => {
    test("should return the underlying database", () => {
      const result = logger.getDatabase();
      expect(result).toBe(db);
    });
  });
});
