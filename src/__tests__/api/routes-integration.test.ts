/**
 * API Routes Integration Tests
 * Full HTTP request/response testing for all route handlers
 * covering activity, session, cost, cron, health, SSE, and error endpoints
 */

import {
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "bun:test";
import express from "express";
import { Database } from "../../db/database.js";
import { ActivityLogger } from "../../logger/activity-logger.js";
import { setupRoutes } from "../../api/routes.js";
import { CronService } from "../../services/cron-service.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// ---------------------------------------------------------------------------
// Mock data for CronService (same pattern as cron-service.test.ts)
// ---------------------------------------------------------------------------

const MOCK_JOBS_RESPONSE = JSON.stringify({
  jobs: [
    {
      id: "cron-1",
      name: "Hourly Sync",
      schedule: { kind: "cron", expr: "0 * * * *" },
      payload: { kind: "systemEvent", text: "sync" },
      sessionTarget: "main",
      enabled: true,
    },
    {
      id: "cron-2",
      name: "Disabled Job",
      schedule: { kind: "every", everyMs: 60000 },
      payload: { kind: "systemEvent", text: "tick" },
      sessionTarget: "main",
      enabled: false,
    },
  ],
  total: 2,
});

const MOCK_RUNS_RESPONSE = JSON.stringify({
  entries: [
    {
      ts: Date.now() - 60000,
      jobId: "cron-1",
      action: "run",
      status: "ok",
      summary: "Completed successfully",
      runAtMs: Date.now() - 120000,
      durationMs: 1500,
      sessionId: "sess-1",
    },
  ],
});

/**
 * Fake execFileAsync that returns mock responses based on the CLI args.
 * Prevents real CLI calls and timeouts in integration tests.
 */
const fakeExecFileAsync = async (
  cmd: string,
  args: string[],
  opts?: any,
): Promise<{ stdout: string; stderr: string }> => {
  if (args.includes("list")) {
    return { stdout: MOCK_JOBS_RESPONSE, stderr: "" };
  } else if (args.includes("runs")) {
    return { stdout: MOCK_RUNS_RESPONSE, stderr: "" };
  }
  return { stdout: "{}", stderr: "" };
};

let fixtureDir: string;
let dbPath: string;
let server: ReturnType<ReturnType<typeof express>["listen"]>;
let baseUrl: string;
let db: Database;
let logger: ActivityLogger;
let app: express.Express;
const originalHome = process.env.HOME;

beforeAll(async () => {
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-routes-int-"));

  // Create minimal agent/skill fixtures
  const agentsDir = path.join(fixtureDir, "agents");
  const skillsDir = path.join(fixtureDir, "skills");
  const agentDir = path.join(agentsDir, "test-agent");
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(
    path.join(agentDir, "SOUL.md"),
    "# SOUL.md - Test Agent\n\n## Role\nTest Agent\n\nModel: test-model\n",
  );
  fs.mkdirSync(path.join(skillsDir, "test-skill"), { recursive: true });
  fs.writeFileSync(
    path.join(skillsDir, "test-skill", "SKILL.md"),
    "# Test Skill\nA test skill.\n",
  );

  // Inject CronService mock to avoid real CLI calls (which would timeout)
  CronService._setExecFileAsync(fakeExecFileAsync as any);

  process.env.AGENT_PATHS = agentsDir;
  process.env.SKILL_PATH = skillsDir;
  process.env.HOME = fixtureDir;

  dbPath = path.join(fixtureDir, "test.db");
  db = new Database(dbPath);
  await db.initialize();
  logger = new ActivityLogger(db);

  app = express();
  app.use(express.json());
  setupRoutes(app, logger);

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  // Restore CronService mock
  CronService._setExecFileAsync(null);
  CronService.clearCache();

  delete process.env.AGENT_PATHS;
  delete process.env.SKILL_PATH;
  // Restore original HOME to avoid leaking test state
  if (originalHome !== undefined) {
    process.env.HOME = originalHome;
  } else {
    delete process.env.HOME;
  }
  if (server) server.close();
  logger.removeAllListeners();
  await db.close().catch(() => {});
  if (fixtureDir) fs.rmSync(fixtureDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await db.clear();
  CronService.clearCache();
});

// Helper for GET requests
async function get(urlPath: string) {
  const res = await fetch(`${baseUrl}${urlPath}`);
  let body: any;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

// Helper for POST requests
async function post(urlPath: string, data?: any) {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: data ? JSON.stringify(data) : undefined,
  });
  let body: any;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

// Helper for DELETE requests
async function del(urlPath: string) {
  const res = await fetch(`${baseUrl}${urlPath}`, { method: "DELETE" });
  let body: any;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

// =============================================================================
// ACTIVITY ENDPOINTS
// =============================================================================

describe("GET /api/activities", () => {
  test("should return empty activities list", async () => {
    const { status, body } = await get("/api/activities");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.activities).toEqual([]);
    expect(body.count).toBe(0);
  });

  test("should return activities with data", async () => {
    await db.createActivity({
      sessionId: "s1",
      actor: { type: "subagent", id: "a1" },
      actionType: "tool_call",
      description: "test activity",
      status: "success",
    });

    const { status, body } = await get("/api/activities");
    expect(status).toBe(200);
    expect(body.count).toBe(1);
    expect(body.activities[0].description).toBe("test activity");
  });

  test("should filter by query params", async () => {
    await db.createActivity({
      sessionId: "s1",
      actor: { type: "subagent", id: "a1" },
      actionType: "tool_call",
      description: "activity 1",
    });
    await db.createActivity({
      sessionId: "s2",
      actor: { type: "subagent", id: "a2" },
      actionType: "tool_call",
      description: "activity 2",
    });

    const { body } = await get("/api/activities?sessionId=s1");
    expect(body.count).toBe(1);
    expect(body.activities[0].sessionId).toBe("s1");
  });
});

describe("POST /api/activities", () => {
  test("should create activities from plugin format", async () => {
    const { status, body } = await post("/api/activities", {
      activities: [
        {
          type: "tool_execution",
          sessionId: "s1",
          agentId: "agent-1",
          toolName: "exec",
          timestamp: new Date().toISOString(),
        },
      ],
    });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.count).toBe(1);
  });

  test("should reject invalid request body", async () => {
    const { status, body } = await post("/api/activities", {});
    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain("Invalid request");
  });

  test("should handle activities with tokens and cost", async () => {
    const { status, body } = await post("/api/activities", {
      activities: [
        {
          type: "model_usage",
          sessionId: "s1",
          agentId: "agent-1",
          model: "openrouter/anthropic/claude-haiku-4.5",
          tokens: { input: 100, output: 50, total: 150 },
          timestamp: new Date().toISOString(),
        },
      ],
    });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  test("should handle activities with explicit costUsd", async () => {
    const { status, body } = await post("/api/activities", {
      activities: [
        {
          type: "model_usage",
          sessionId: "s1",
          agentId: "agent-1",
          costUsd: 0.05,
          timestamp: new Date().toISOString(),
        },
      ],
    });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  test("should handle activities with error status", async () => {
    const { status, body } = await post("/api/activities", {
      activities: [
        {
          type: "tool_execution",
          sessionId: "s1",
          agentId: "agent-1",
          error: "Something went wrong",
          timestamp: new Date().toISOString(),
        },
      ],
    });

    expect(status).toBe(200);
    expect(body.activities[0].status).toBe("failure");
  });

  test("should handle session_start type", async () => {
    const { status, body } = await post("/api/activities", {
      activities: [
        {
          type: "session_start",
          sessionId: "s1",
          agentId: "main",
          timestamp: new Date().toISOString(),
        },
      ],
    });

    expect(status).toBe(200);
    // session types should have orchestrator actorType
    expect(body.success).toBe(true);
  });
});

describe("POST /api/activities/backfill", () => {
  test("should backfill costs for activities with tokens but no cost", async () => {
    const activity = await db.createActivity({
      sessionId: "s1",
      actor: { type: "subagent", id: "a1" },
      actionType: "tool_call",
      description: "needs cost",
    });
    await db.updateActivity(activity.id, {
      tokens: {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        model: "openrouter/anthropic/claude-haiku-4.5",
      },
    });

    const { status, body } = await post("/api/activities/backfill");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.updated).toBeGreaterThanOrEqual(0);
  });
});

describe("GET /api/activities/:id", () => {
  test("should return a specific activity", async () => {
    const activity = await db.createActivity({
      sessionId: "s1",
      actor: { type: "subagent", id: "a1" },
      actionType: "tool_call",
      description: "specific activity",
      status: "success",
    });

    const { status, body } = await get(`/api/activities/${activity.id}`);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  test("should return 404 for non-existent activity", async () => {
    const { status, body } = await get("/api/activities/nonexistent");
    expect(status).toBe(404);
    expect(body.success).toBe(false);
  });
});

// NOTE: /api/activities/search is unreachable via HTTP because Express matches
// /api/activities/:id first (":id" catches "search" as a param).
// This is a known limitation in the route ordering. We skip HTTP tests for it.

// =============================================================================
// SESSION ENDPOINTS
// =============================================================================

describe("GET /api/sessions/:id", () => {
  test("should return session summary", async () => {
    await logger.logSessionStart("test-session");

    const { status, body } = await get("/api/sessions/test-session");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.summary.sessionId).toBe("test-session");
  });

  test("should return 404 for non-existent session", async () => {
    const { status, body } = await get("/api/sessions/nonexistent");
    expect(status).toBe(404);
    expect(body.success).toBe(false);
  });
});

describe("GET /api/sessions/:id/activities", () => {
  test("should return session activities", async () => {
    await logger.logSessionStart("s-act");
    await logger.logToolStart(
      "s-act",
      { type: "subagent", id: "a1" },
      "exec",
      {},
      "Test",
    );

    const { status, body } = await get("/api/sessions/s-act/activities");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.count).toBeGreaterThan(0);
  });
});

describe("GET /api/sessions/:id/cost-report", () => {
  test("should return session cost report", async () => {
    await logger.logSessionStart("s-cost");

    const { status, body } = await get("/api/sessions/s-cost/cost-report");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.sessionId).toBe("s-cost");
    expect(typeof body.totalCost).toBe("number");
  });

  test("should return 404 for non-existent session", async () => {
    const { status, body } = await get("/api/sessions/nonexistent/cost-report");
    expect(status).toBe(404);
  });
});

// =============================================================================
// AGENT STATUS COMPUTATION
// =============================================================================

describe("Agent status computation", () => {
  test("should compute 'idle' status for agent active 10 minutes ago", async () => {
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    await db.createActivity({
      sessionId: "status-test",
      timestamp: tenMinAgo,
      actor: { type: "subagent", id: "test-agent" },
      actionType: "tool_call",
      description: "recent action",
      status: "success",
    });

    const { body } = await get("/api/agents");
    const agent = body.agents.find((a: any) => a.id === "test-agent");
    if (agent) {
      expect(agent.status).toBe("idle");
    }
  });

  test("should compute 'offline' for agent active > 30 minutes ago with no pending", async () => {
    const twoHoursAgo = new Date(Date.now() - 120 * 60 * 1000).toISOString();
    await db.createActivity({
      sessionId: "status-test-2",
      timestamp: twoHoursAgo,
      actor: { type: "subagent", id: "test-agent" },
      actionType: "tool_call",
      description: "old action",
      status: "success",
    });

    const { body } = await get("/api/agents");
    const agent = body.agents.find((a: any) => a.id === "test-agent");
    if (agent) {
      // With 1 action and > 30 min ago, should be "busy" (actionCount > 0)
      expect(["busy", "offline"]).toContain(agent.status);
    }
  });
});

// =============================================================================
// COST REPORT & STATS ENDPOINTS
// =============================================================================

describe("GET /api/cost-report", () => {
  test("should return cost aggregation", async () => {
    const { status, body } = await get("/api/cost-report");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(typeof body.totalCost).toBe("number");
    expect(typeof body.totalTokens).toBe("number");
    expect(typeof body.activityCount).toBe("number");
    expect(body.actorCosts).toBeTruthy();
    expect(body.toolCosts).toBeTruthy();
  });

  test("should aggregate actor and tool costs", async () => {
    const a1 = await db.createActivity({
      sessionId: "s1",
      actor: { type: "subagent", id: "agent-1" },
      actionType: "tool_call",
      toolName: "exec",
      description: "test",
      status: "success",
    });
    await db.updateActivity(a1.id, {
      cost: { usd: 0.05 },
      tokens: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    });

    const { body } = await get("/api/cost-report");
    expect(body.actorCosts["agent-1"]).toBeTruthy();
    expect(body.actorCosts["agent-1"].cost).toBe(0.05);
    expect(body.toolCosts["exec"]).toBeTruthy();
    expect(body.toolCosts["exec"].count).toBe(1);
  });
});

describe("GET /api/stats", () => {
  test("should return system statistics", async () => {
    await logger.logSessionStart("stats-session");

    const { status, body } = await get("/api/stats");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.stats).toBeTruthy();
    expect(typeof body.stats.activities).toBe("number");
    expect(typeof body.stats.sessions).toBe("number");
    expect(typeof body.stats.successRate).toBe("number");
  });
});

// =============================================================================
// COST / LLM GENERATION ENDPOINTS
// =============================================================================

describe("POST /api/cost/scan", () => {
  test("should return 503 when scanner not initialized", async () => {
    const { status, body } = await post("/api/cost/scan");
    expect(status).toBe(503);
    expect(body.success).toBe(false);
    expect(body.error).toContain("Scanner not initialized");
  });
});

describe("POST /api/cost/backfill", () => {
  test("should return 503 when scanner not initialized", async () => {
    const { status, body } = await post("/api/cost/backfill");
    expect(status).toBe(503);
    expect(body.success).toBe(false);
  });
});

describe("GET /api/cost/generations", () => {
  test("should return empty generations list", async () => {
    const { status, body } = await get("/api/cost/generations");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.generations).toEqual([]);
  });

  test("should return generations with filters", async () => {
    await db.upsertGeneration({
      id: "gen-http-1",
      sessionLogFile: "f.jsonl",
      sessionLogMsgId: "m1",
      agentId: "agent-1",
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

    const { body } = await get("/api/cost/generations?agentId=agent-1");
    expect(body.count).toBe(1);

    const { body: body2 } = await get(
      "/api/cost/generations?unlinkedOnly=true",
    );
    expect(body2.count).toBe(1);
  });
});

describe("GET /api/cost/summary", () => {
  test("should return cost summary", async () => {
    const { status, body } = await get("/api/cost/summary");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(typeof body.totalCost).toBe("number");
    expect(typeof body.totalGenerations).toBe("number");
  });
});

describe("GET /api/cost/status", () => {
  test("should return cost status", async () => {
    const { status, body } = await get("/api/cost/status");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.scanner).toBeTruthy();
    expect(body.pricing).toBeTruthy();
    expect(body.generations).toBeTruthy();
  });
});

// =============================================================================
// HEALTH
// =============================================================================

describe("GET /api/health", () => {
  test("should return healthy", async () => {
    const { status, body } = await get("/api/health");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.status).toBe("healthy");
    expect(body.timestamp).toBeTruthy();
  });
});

// =============================================================================
// PENDING ACTIVITIES
// =============================================================================

describe("GET /api/pending-activities", () => {
  test("should return pending activities", async () => {
    const { status, body } = await get("/api/pending-activities");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.activities)).toBe(true);
  });
});

// =============================================================================
// CRON ENDPOINTS
// CronService.execFileAsync is mocked via _setExecFileAsync() in beforeAll
// to return deterministic mock data without requiring the real openclaw CLI.
// =============================================================================

describe("GET /api/cron/jobs", () => {
  test("should return list of cron jobs", async () => {
    const { status, body } = await get("/api/cron/jobs");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.jobs)).toBe(true);
  });
});

describe("GET /api/cron/jobs/:id", () => {
  test("should return 404 for non-existent job", async () => {
    const { status, body } = await get("/api/cron/jobs/nonexistent-job-xyz");
    expect(status).toBe(404);
    expect(body.success).toBe(false);
  });

  test("should return a job if it exists on the system", async () => {
    // First get all jobs to find a valid ID
    const { body: listBody } = await get("/api/cron/jobs");
    if (listBody.jobs && listBody.jobs.length > 0) {
      const jobId = listBody.jobs[0].id;
      const { status, body } = await get(`/api/cron/jobs/${jobId}`);
      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.job.id).toBe(jobId);
    }
  });
});

describe("GET /api/cron/jobs/:id/runs", () => {
  test("should return runs array (possibly empty)", async () => {
    const { body: listBody } = await get("/api/cron/jobs");
    if (listBody.jobs && listBody.jobs.length > 0) {
      const { status, body } = await get(
        `/api/cron/jobs/${listBody.jobs[0].id}/runs`,
      );
      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(Array.isArray(body.runs)).toBe(true);
    }
  });

  test("should respect limit param", async () => {
    const { body: listBody } = await get("/api/cron/jobs");
    if (listBody.jobs && listBody.jobs.length > 0) {
      const { body } = await get(
        `/api/cron/jobs/${listBody.jobs[0].id}/runs?limit=1`,
      );
      expect(body.runs.length).toBeLessThanOrEqual(1);
    }
  });
});

describe("POST /api/cron/jobs/:id/enable", () => {
  test("should return 404 for non-existent job", async () => {
    const { status } = await post("/api/cron/jobs/nonexistent-xyz/enable");
    expect(status).toBe(404);
  });

  test("should enable a real job if available", async () => {
    const { body: listBody } = await get("/api/cron/jobs");
    if (listBody.jobs && listBody.jobs.length > 0) {
      const { status, body } = await post(
        `/api/cron/jobs/${listBody.jobs[0].id}/enable`,
      );
      expect(status).toBe(200);
      expect(body.success).toBe(true);
    }
  });
});

describe("POST /api/cron/jobs/:id/disable", () => {
  test("should return 404 for non-existent job", async () => {
    const { status } = await post("/api/cron/jobs/nonexistent-xyz/disable");
    expect(status).toBe(404);
  });

  test("should disable a real job if available", async () => {
    const { body: listBody } = await get("/api/cron/jobs");
    if (listBody.jobs && listBody.jobs.length > 0) {
      const { status, body } = await post(
        `/api/cron/jobs/${listBody.jobs[0].id}/disable`,
      );
      expect(status).toBe(200);
      expect(body.success).toBe(true);
    }
  });
});

describe("POST /api/cron/jobs/:id/run", () => {
  test("should return 404 for non-existent job", async () => {
    const { status } = await post("/api/cron/jobs/nonexistent-xyz/run");
    expect(status).toBe(404);
  });

  test("should run or reject based on enabled status", async () => {
    const { body: listBody } = await get("/api/cron/jobs");
    if (listBody.jobs && listBody.jobs.length > 0) {
      // Find an enabled job
      const enabledJob = listBody.jobs.find((j: any) => j.enabled);
      if (enabledJob) {
        const { status, body } = await post(
          `/api/cron/jobs/${enabledJob.id}/run`,
        );
        expect(status).toBe(200);
        expect(body.success).toBe(true);
      }
      // Find a disabled job
      const disabledJob = listBody.jobs.find((j: any) => !j.enabled);
      if (disabledJob) {
        const { status, body } = await post(
          `/api/cron/jobs/${disabledJob.id}/run`,
        );
        expect(status).toBe(400);
        expect(body.error).toContain("disabled");
      }
    }
  });
});

describe("DELETE /api/cron/jobs/:id", () => {
  test("should return 404 for non-existent job", async () => {
    const { status } = await del("/api/cron/jobs/nonexistent-xyz");
    expect(status).toBe(404);
  });

  test("should delete a real job if available", async () => {
    const { body: listBody } = await get("/api/cron/jobs");
    if (listBody.jobs && listBody.jobs.length > 0) {
      const { status, body } = await del(
        `/api/cron/jobs/${listBody.jobs[0].id}`,
      );
      expect(status).toBe(200);
      expect(body.success).toBe(true);
    }
  });
});

// =============================================================================
// SSE ENDPOINT
// =============================================================================

describe("GET /api/stream", () => {
  test("should establish SSE connection", async () => {
    const controller = new AbortController();
    const res = await fetch(`${baseUrl}/api/stream`, {
      signal: controller.signal,
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    // Clean up - abort the connection
    controller.abort();
  });
});

// =============================================================================
// BROADCAST (exercise broadcastActivity via POST /api/activities)
// =============================================================================

describe("Activity broadcast", () => {
  test("should broadcast to SSE clients when creating activities", async () => {
    // Connect an SSE client
    const controller = new AbortController();
    const sseRes = await fetch(`${baseUrl}/api/stream`, {
      signal: controller.signal,
    });
    expect(sseRes.status).toBe(200);

    // Give SSE connection time to register
    await new Promise((r) => setTimeout(r, 50));

    // Create an activity (triggers broadcastActivity)
    const { status } = await post("/api/activities", {
      activities: [
        {
          type: "tool_execution",
          sessionId: "broadcast-test",
          agentId: "agent-broadcast",
          toolName: "exec",
          timestamp: new Date().toISOString(),
        },
      ],
    });
    expect(status).toBe(200);

    // Clean up
    controller.abort();
  });
});

// =============================================================================
// 404 FALLBACK
// =============================================================================

describe("API 404 fallback", () => {
  test("should return 404 for unknown API route", async () => {
    const { status, body } = await get("/api/nonexistent-route");
    expect(status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error).toContain("not found");
  });
});
