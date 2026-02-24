/**
 * Extended Database Tests
 * Covers getAgentStats, getSessionSummary edge cases,
 * getGenerationSummary with filters, and scan state operations
 */

import { describe, test, expect, beforeEach, afterEach, afterAll } from "bun:test";
import { Database } from "../../db/database.js";
import * as fs from "fs";

const TEST_DB_PATH = "./test-data/test-db-extended.db";

describe("Database Extended", () => {
  let db: Database;

  beforeEach(async () => {
    if (!fs.existsSync("./test-data")) {
      fs.mkdirSync("./test-data", { recursive: true });
    }
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

  // ==========================================================================
  // getAgentStats
  // ==========================================================================

  describe("getAgentStats", () => {
    test("should return empty map when no activities", async () => {
      const stats = await db.getAgentStats();
      expect(stats.size).toBe(0);
    });

    test("should aggregate stats per agent", async () => {
      // Create activities for two agents
      await db.createSession("session-1");
      await db.createSession("session-2");

      const act1 = await db.createActivity({
        sessionId: "session-1",
        actor: { type: "subagent", id: "engineer" },
        actionType: "tool_call",
        description: "Activity 1",
        status: "success",
      });

      await db.updateActivity(act1.id, {
        cost: { usd: 0.05 },
        tokens: { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 },
      });

      const act2 = await db.createActivity({
        sessionId: "session-2",
        actor: { type: "subagent", id: "engineer" },
        actionType: "tool_call",
        description: "Activity 2",
        status: "pending",
      });

      await db.createActivity({
        sessionId: "session-1",
        actor: { type: "subagent", id: "reviewer" },
        actionType: "tool_call",
        description: "Review activity",
        status: "success",
      });

      const stats = await db.getAgentStats();

      expect(stats.size).toBe(2);

      const engineerStats = stats.get("engineer");
      expect(engineerStats).toBeTruthy();
      expect(engineerStats!.sessionCount).toBe(2);
      expect(engineerStats!.totalCost).toBeGreaterThan(0);
      expect(engineerStats!.totalTokens).toBe(1500);
      expect(engineerStats!.pendingCount).toBe(1);

      const reviewerStats = stats.get("reviewer");
      expect(reviewerStats).toBeTruthy();
      expect(reviewerStats!.sessionCount).toBe(1);
      expect(reviewerStats!.pendingCount).toBe(0);
    });
  });

  // ==========================================================================
  // getSessionSummary
  // ==========================================================================

  describe("getSessionSummary", () => {
    test("should return null for non-existent session", async () => {
      const summary = await db.getSessionSummary("nonexistent");
      expect(summary).toBeNull();
    });

    test("should compute full summary with actors and tools", async () => {
      await db.createSession("s1");

      const a1 = await db.createActivity({
        sessionId: "s1",
        actor: { type: "subagent", id: "agent-1" },
        actionType: "tool_call",
        toolName: "exec",
        description: "Run exec",
        status: "success",
      });
      await db.updateActivity(a1.id, {
        cost: { usd: 0.01 },
        tokens: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        durationMs: 200,
      });

      const a2 = await db.createActivity({
        sessionId: "s1",
        actor: { type: "subagent", id: "agent-1" },
        actionType: "tool_call",
        toolName: "exec",
        description: "Run exec again",
        status: "success",
      });
      await db.updateActivity(a2.id, {
        cost: { usd: 0.02 },
        tokens: { inputTokens: 200, outputTokens: 100, totalTokens: 300 },
        durationMs: 300,
      });

      const a3 = await db.createActivity({
        sessionId: "s1",
        actor: { type: "subagent", id: "agent-2" },
        actionType: "tool_call",
        toolName: "read",
        description: "Read file",
        status: "failure",
      });

      const summary = await db.getSessionSummary("s1");
      expect(summary).toBeTruthy();
      expect(summary!.stats.totalActions).toBe(3);
      expect(summary!.stats.successCount).toBe(2);
      expect(summary!.stats.failureCount).toBe(1);
      expect(summary!.stats.successRate).toBeCloseTo(66.67, 0);
      expect(summary!.stats.totalCost).toBe(0.03);
      expect(summary!.stats.totalTokens).toBe(450);
      expect(summary!.stats.avgActionDuration).toBeGreaterThan(0);

      // Actor breakdown
      expect(summary!.actors["agent-1"]).toBeTruthy();
      expect(summary!.actors["agent-1"].actionsCount).toBe(2);
      expect(summary!.actors["agent-1"].successCount).toBe(2);
      expect(summary!.actors["agent-2"].actionsCount).toBe(1);

      // Top tools
      expect(summary!.topTools.length).toBeGreaterThanOrEqual(1);
      const execTool = summary!.topTools.find((t) => t.name === "exec");
      expect(execTool?.count).toBe(2);
    });

    test("should handle session with no activities", async () => {
      await db.createSession("empty-session");
      const summary = await db.getSessionSummary("empty-session");
      expect(summary).toBeTruthy();
      expect(summary!.stats.totalActions).toBe(0);
      expect(summary!.stats.successRate).toBe(0);
      expect(summary!.stats.avgActionDuration).toBe(0);
    });
  });

  // ==========================================================================
  // getGenerationSummary with filters
  // ==========================================================================

  describe("getGenerationSummary", () => {
    test("should return zero totals when no generations exist", async () => {
      const summary = await db.getGenerationSummary();
      expect(summary.totalCost).toBe(0);
      expect(summary.totalGenerations).toBe(0);
      expect(summary.totalInputTokens).toBe(0);
      expect(summary.totalOutputTokens).toBe(0);
      expect(Object.keys(summary.byAgent)).toHaveLength(0);
      expect(Object.keys(summary.byModel)).toHaveLength(0);
    });

    test("should aggregate by agent and model", async () => {
      await db.upsertGeneration({
        id: "gen-1",
        sessionLogFile: "f1.jsonl",
        sessionLogMsgId: "m1",
        agentId: "engineer",
        timestamp: "2025-01-15T10:00:00Z",
        model: "claude-sonnet",
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 1500,
        costInput: 0.003,
        costOutput: 0.0075,
        costCacheRead: 0,
        costTotal: 0.0105,
      });

      await db.upsertGeneration({
        id: "gen-2",
        sessionLogFile: "f2.jsonl",
        sessionLogMsgId: "m2",
        agentId: "reviewer",
        timestamp: "2025-01-15T11:00:00Z",
        model: "claude-haiku",
        inputTokens: 500,
        outputTokens: 200,
        cacheReadTokens: 100,
        cacheWriteTokens: 0,
        totalTokens: 700,
        costInput: 0.000125,
        costOutput: 0.00025,
        costCacheRead: 0.00001,
        costTotal: 0.000385,
      });

      const summary = await db.getGenerationSummary();

      expect(summary.totalGenerations).toBe(2);
      expect(summary.totalCost).toBeCloseTo(0.010885, 5);
      expect(summary.totalInputTokens).toBe(1500);
      expect(summary.totalOutputTokens).toBe(700);
      expect(summary.totalCacheReadTokens).toBe(100);

      expect(summary.byAgent["engineer"]).toBeTruthy();
      expect(summary.byAgent["engineer"].generations).toBe(1);
      expect(summary.byAgent["reviewer"]).toBeTruthy();

      expect(summary.byModel["claude-sonnet"]).toBeTruthy();
      expect(summary.byModel["claude-haiku"]).toBeTruthy();
    });

    test("should filter by time range", async () => {
      await db.upsertGeneration({
        id: "gen-early",
        sessionLogFile: "f1.jsonl",
        sessionLogMsgId: "m1",
        agentId: "engineer",
        timestamp: "2025-01-10T10:00:00Z",
        model: "claude-sonnet",
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 150,
        costInput: 0.0003,
        costOutput: 0.00075,
        costCacheRead: 0,
        costTotal: 0.00105,
      });

      await db.upsertGeneration({
        id: "gen-late",
        sessionLogFile: "f2.jsonl",
        sessionLogMsgId: "m2",
        agentId: "engineer",
        timestamp: "2025-01-20T10:00:00Z",
        model: "claude-sonnet",
        inputTokens: 200,
        outputTokens: 100,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 300,
        costInput: 0.0006,
        costOutput: 0.0015,
        costCacheRead: 0,
        costTotal: 0.0021,
      });

      const filtered = await db.getGenerationSummary({
        startTime: "2025-01-15T00:00:00Z",
      });

      expect(filtered.totalGenerations).toBe(1);
      expect(filtered.totalInputTokens).toBe(200);
    });
  });

  // ==========================================================================
  // getGenerations with filters
  // ==========================================================================

  describe("getGenerations", () => {
    test("should filter by agentId", async () => {
      await db.upsertGeneration({
        id: "g1",
        sessionLogFile: "f.jsonl",
        sessionLogMsgId: "m1",
        agentId: "engineer",
        timestamp: "2025-01-15T10:00:00Z",
        model: "claude-sonnet",
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 150,
        costInput: 0.003,
        costOutput: 0.0075,
        costCacheRead: 0,
        costTotal: 0.0105,
      });

      await db.upsertGeneration({
        id: "g2",
        sessionLogFile: "f.jsonl",
        sessionLogMsgId: "m2",
        agentId: "reviewer",
        timestamp: "2025-01-15T11:00:00Z",
        model: "claude-haiku",
        inputTokens: 50,
        outputTokens: 25,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 75,
        costInput: 0.001,
        costOutput: 0.002,
        costCacheRead: 0,
        costTotal: 0.003,
      });

      const filtered = await db.getGenerations({ agentId: "engineer" });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].agent_id).toBe("engineer");
    });

    test("should filter by model", async () => {
      await db.upsertGeneration({
        id: "gm1",
        sessionLogFile: "f.jsonl",
        sessionLogMsgId: "mm1",
        agentId: "eng",
        timestamp: "2025-01-15T10:00:00Z",
        model: "claude-sonnet",
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 150,
        costInput: 0.003,
        costOutput: 0.0075,
        costCacheRead: 0,
        costTotal: 0.0105,
      });

      const filtered = await db.getGenerations({ model: "claude-sonnet" });
      expect(filtered).toHaveLength(1);
    });

    test("should filter by time range", async () => {
      await db.upsertGeneration({
        id: "gt1",
        sessionLogFile: "f.jsonl",
        sessionLogMsgId: "mt1",
        agentId: "eng",
        timestamp: "2025-01-10T10:00:00Z",
        model: "m",
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 150,
        costInput: 0,
        costOutput: 0,
        costCacheRead: 0,
        costTotal: 0,
      });

      await db.upsertGeneration({
        id: "gt2",
        sessionLogFile: "f.jsonl",
        sessionLogMsgId: "mt2",
        agentId: "eng",
        timestamp: "2025-01-20T10:00:00Z",
        model: "m",
        inputTokens: 200,
        outputTokens: 100,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 300,
        costInput: 0,
        costOutput: 0,
        costCacheRead: 0,
        costTotal: 0,
      });

      const filtered = await db.getGenerations({
        startTime: "2025-01-15T00:00:00Z",
        endTime: "2025-01-25T00:00:00Z",
      });
      expect(filtered).toHaveLength(1);
    });

    test("should paginate with limit and offset", async () => {
      for (let i = 0; i < 5; i++) {
        await db.upsertGeneration({
          id: `gp-${i}`,
          sessionLogFile: `f${i}.jsonl`,
          sessionLogMsgId: `mp-${i}`,
          agentId: "eng",
          timestamp: `2025-01-${15 + i}T10:00:00Z`,
          model: "m",
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 150,
          costInput: 0,
          costOutput: 0,
          costCacheRead: 0,
          costTotal: 0,
        });
      }

      const page1 = await db.getGenerations({ limit: 2 });
      expect(page1).toHaveLength(2);

      const page2 = await db.getGenerations({ limit: 2, offset: 2 });
      expect(page2).toHaveLength(2);
      expect(page2[0].id).not.toBe(page1[0].id);
    });
  });

  // ==========================================================================
  // Scan State Operations
  // ==========================================================================

  describe("Scan State Operations", () => {
    test("should return null for unknown file", async () => {
      const state = await db.getScanState("/nonexistent.jsonl");
      expect(state).toBeNull();
    });

    test("should update and retrieve scan state", async () => {
      await db.updateScanState("/test.jsonl", 1024, 2048);

      const state = await db.getScanState("/test.jsonl");
      expect(state).toBeTruthy();
      expect(state!.lastOffset).toBe(1024);
      expect(state!.fileSize).toBe(2048);
      expect(state!.lastScannedAt).toBeTruthy();
    });

    test("should upsert scan state on conflict", async () => {
      await db.updateScanState("/test.jsonl", 100, 200);
      await db.updateScanState("/test.jsonl", 500, 1000);

      const state = await db.getScanState("/test.jsonl");
      expect(state!.lastOffset).toBe(500);
      expect(state!.fileSize).toBe(1000);
    });

    test("should reset all scan state", async () => {
      await db.updateScanState("/file1.jsonl", 100, 200);
      await db.updateScanState("/file2.jsonl", 300, 400);

      await db.resetScanState();

      const state1 = await db.getScanState("/file1.jsonl");
      const state2 = await db.getScanState("/file2.jsonl");
      expect(state1).toBeNull();
      expect(state2).toBeNull();
    });
  });

  // ==========================================================================
  // updateSession
  // ==========================================================================

  describe("updateSession", () => {
    test("should update session end time", async () => {
      await db.createSession("s-update");
      const endTime = new Date().toISOString();
      await db.updateSession("s-update", endTime);

      const summary = await db.getSessionSummary("s-update");
      expect(summary).toBeTruthy();
      expect(summary!.endTime).toBe(endTime);
    });
  });

  // ==========================================================================
  // getActivities with more filter options
  // ==========================================================================

  describe("getActivities extended filters", () => {
    test("should filter by actorType", async () => {
      await db.createActivity({
        sessionId: "s1",
        actor: { type: "subagent", id: "a1" },
        actionType: "tool_call",
        description: "sub action",
      });
      await db.createActivity({
        sessionId: "s1",
        actor: { type: "user", id: "ben" },
        actionType: "user_request",
        description: "user action",
      });

      const activities = await db.getActivities({ actorType: "user" });
      expect(activities).toHaveLength(1);
      expect(activities[0].actor.type).toBe("user");
    });

    test("should filter by actionType", async () => {
      await db.createActivity({
        sessionId: "s1",
        actor: { type: "subagent", id: "a1" },
        actionType: "tool_call",
        description: "tool",
      });
      await db.createActivity({
        sessionId: "s1",
        actor: { type: "subagent", id: "a1" },
        actionType: "delegation",
        description: "delegate",
      });

      const activities = await db.getActivities({ actionType: "delegation" });
      expect(activities).toHaveLength(1);
    });

    test("should filter by toolName", async () => {
      await db.createActivity({
        sessionId: "s1",
        actor: { type: "subagent", id: "a1" },
        actionType: "tool_call",
        toolName: "exec",
        description: "exec call",
      });
      await db.createActivity({
        sessionId: "s1",
        actor: { type: "subagent", id: "a1" },
        actionType: "tool_call",
        toolName: "read",
        description: "read call",
      });

      const activities = await db.getActivities({ toolName: "exec" });
      expect(activities).toHaveLength(1);
      expect(activities[0].toolName).toBe("exec");
    });

    test("should filter by status", async () => {
      const a1 = await db.createActivity({
        sessionId: "s1",
        actor: { type: "subagent", id: "a1" },
        actionType: "tool_call",
        description: "success",
        status: "success",
      });
      await db.createActivity({
        sessionId: "s1",
        actor: { type: "subagent", id: "a1" },
        actionType: "tool_call",
        description: "failure",
        status: "failure",
      });

      const activities = await db.getActivities({ status: "failure" });
      expect(activities).toHaveLength(1);
      expect(activities[0].status).toBe("failure");
    });

    test("should filter by time range", async () => {
      await db.createActivity({
        sessionId: "s1",
        timestamp: "2025-01-10T10:00:00Z",
        actor: { type: "subagent", id: "a1" },
        actionType: "tool_call",
        description: "early",
      });
      await db.createActivity({
        sessionId: "s1",
        timestamp: "2025-01-20T10:00:00Z",
        actor: { type: "subagent", id: "a1" },
        actionType: "tool_call",
        description: "late",
      });

      const activities = await db.getActivities({
        startTime: "2025-01-15T00:00:00Z",
        endTime: "2025-01-25T00:00:00Z",
      });
      expect(activities).toHaveLength(1);
    });
  });

  // ==========================================================================
  // updateActivity extended
  // ==========================================================================

  describe("updateActivity extended", () => {
    test("should update completedAt and durationMs", async () => {
      const a = await db.createActivity({
        sessionId: "s1",
        actor: { type: "subagent", id: "a1" },
        actionType: "tool_call",
        description: "test",
      });

      const completedAt = "2025-01-15T10:01:00Z";
      await db.updateActivity(a.id, { completedAt, durationMs: 500 });

      const updated = await db.getActivity(a.id);
      expect(updated!.completedAt).toBe(completedAt);
      expect(updated!.durationMs).toBe(500);
    });

    test("should update result", async () => {
      const a = await db.createActivity({
        sessionId: "s1",
        actor: { type: "subagent", id: "a1" },
        actionType: "tool_call",
        description: "test",
      });

      await db.updateActivity(a.id, {
        result: { success: true, output: "done" },
      });

      const updated = await db.getActivity(a.id);
      expect(updated!.result).toBeTruthy();
      expect(updated!.result!.success).toBe(true);
      expect(updated!.result!.output).toBe("done");
    });

    test("should no-op when no fields provided", async () => {
      const a = await db.createActivity({
        sessionId: "s1",
        actor: { type: "subagent", id: "a1" },
        actionType: "tool_call",
        description: "test",
        status: "pending",
      });

      await db.updateActivity(a.id, {});

      const updated = await db.getActivity(a.id);
      expect(updated!.status).toBe("pending");
    });
  });

  // ==========================================================================
  // linkGeneration
  // ==========================================================================

  describe("linkGeneration", () => {
    test("should link a generation to an activity", async () => {
      const activity = await db.createActivity({
        sessionId: "s1",
        actor: { type: "subagent", id: "a1" },
        actionType: "tool_call",
        description: "test",
      });

      await db.upsertGeneration({
        id: "gen-link",
        sessionLogFile: "f.jsonl",
        sessionLogMsgId: "m-link",
        agentId: "a1",
        timestamp: "2025-01-15T10:00:00Z",
        model: "claude",
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 150,
        costInput: 0,
        costOutput: 0,
        costCacheRead: 0,
        costTotal: 0,
      });

      await db.linkGeneration("gen-link", activity.id);

      const gens = await db.getGenerations({ unlinkedOnly: true });
      expect(gens).toHaveLength(0);

      const all = await db.getGenerations();
      expect(all[0].linked_activity_id).toBe(activity.id);
    });
  });
});
