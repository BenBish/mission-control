/**
 * ORC-40: Agents dashboard shows "Never ran" — stats lookup uses wrong ID format
 *
 * Bug 1 (PRIMARY): buildActivityStatsMap() normalizes IDs to short form via
 * toActorId(), but the GET /api/agents and GET /api/agents/:id endpoints
 * looked up stats using raw agent.id (workspace-prefixed). Fix: apply
 * toActorId() at lookup sites.
 *
 * Bug 2 (SECONDARY): The generation merge loop in buildActivityStatsMap() never
 * populated lastActive from llm_generations timestamps. Fix: use MAX(timestamp)
 * from getGenerationSummary() and take the more recent of activities vs
 * generations.
 *
 * Test coverage:
 *   TC-1: Workspace-prefixed agent IDs resolve to correct stats (Fix 1)
 *   TC-2: Short-form agent IDs still resolve correctly (Fix 1)
 *   TC-3: GET /api/agents/:id with workspace-prefixed ID (Fix 1)
 *   TC-4: Agent with activity only in llm_generations (Fix 2)
 *   TC-5: Agent with activity in both tables uses most recent (Fix 2)
 *   TC-6: Agent with activity only in activities table (baseline)
 *   TC-7: No regression from ORC-35 fix
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import express from "express";
import { Database } from "../db/database.js";
import { ActivityLogger } from "../logger/activity-logger.js";
import { setupRoutes } from "../api/routes.js";
import { toActorId } from "../lib/agent-utils.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

let fixtureDir: string;
let agentsDir: string;
let server: ReturnType<ReturnType<typeof express>["listen"]>;
let baseUrl: string;
let db: Database;
let logger: ActivityLogger;

function createFixtures() {
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "orc40-test-"));
  agentsDir = path.join(fixtureDir, "agents");

  // Create agents that mimic workspace-prefixed directory structure.
  // When AgentService scans these via AGENT_PATHS, extractAgentId will
  // return the directory name directly (e.g. "workspace-engineer").

  // Agent: workspace-engineer — will have activity in activities table
  const wsEngineerDir = path.join(agentsDir, "workspace-engineer");
  fs.mkdirSync(wsEngineerDir, { recursive: true });
  fs.writeFileSync(
    path.join(wsEngineerDir, "SOUL.md"),
    `# SOUL.md - Engineer\n\n## Role\nSenior Software Engineer\n\nModel: openrouter/anthropic/claude-sonnet-4.5\n`,
  );

  // Agent: workspace-reviewer — will have activity ONLY in llm_generations
  const wsReviewerDir = path.join(agentsDir, "workspace-reviewer");
  fs.mkdirSync(wsReviewerDir, { recursive: true });
  fs.writeFileSync(
    path.join(wsReviewerDir, "SOUL.md"),
    `# SOUL.md - Reviewer\n\n## Role\nCode Reviewer\n\nModel: openrouter/anthropic/claude-haiku-4.5\n`,
  );

  // Agent: workspace-planner — will have activity in BOTH tables
  const wsPlannerDir = path.join(agentsDir, "workspace-planner");
  fs.mkdirSync(wsPlannerDir, { recursive: true });
  fs.writeFileSync(
    path.join(wsPlannerDir, "SOUL.md"),
    `# SOUL.md - Planner\n\n## Role\nProject Planner\n\nModel: openrouter/anthropic/claude-sonnet-4\n`,
  );

  // Agent: designer — short-form ID (no workspace prefix)
  const designerDir = path.join(agentsDir, "designer");
  fs.mkdirSync(designerDir, { recursive: true });
  fs.writeFileSync(
    path.join(designerDir, "SOUL.md"),
    `# SOUL.md - Designer\n\n## Role\nUI Designer\n\nModel: openrouter/anthropic/claude-sonnet-4.5\n`,
  );

  // Agent: idle-agent — no activity at all (truly never ran)
  const idleDir = path.join(agentsDir, "idle-agent");
  fs.mkdirSync(idleDir, { recursive: true });
  fs.writeFileSync(
    path.join(idleDir, "SOUL.md"),
    `# SOUL.md - Idle Agent\n\n## Role\nDormant\n\nModel: openrouter/anthropic/claude-haiku-4.5\n`,
  );
}

function cleanupFixtures() {
  if (fixtureDir && fs.existsSync(fixtureDir)) {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
}

async function api(urlPath: string) {
  const res = await fetch(`${baseUrl}${urlPath}`);
  const body = await res.json();
  return { status: res.status, body };
}

beforeAll(async () => {
  createFixtures();

  process.env.AGENT_PATHS = agentsDir;

  const dbPath = path.join(fixtureDir, "test.db");
  db = new Database(dbPath);
  await db.initialize();
  logger = new ActivityLogger(db);

  const app = express();
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

  const now = Date.now();

  // --- Activities table seeding ---

  // workspace-engineer: recent activity (2 min ago) using workspace-prefixed ID
  await db.createActivity({
    sessionId: "session-eng-1",
    timestamp: new Date(now - 2 * 60_000).toISOString(),
    actor: { id: "workspace-engineer", type: "subagent" },
    actionType: "tool_call",
    description: "Building code",
    status: "success",
  });

  // workspace-planner: activity in activities table (20 min ago)
  await db.createActivity({
    sessionId: "session-plan-1",
    timestamp: new Date(now - 20 * 60_000).toISOString(),
    actor: { id: "workspace-planner", type: "subagent" },
    actionType: "decision",
    description: "Planning sprint",
    status: "success",
  });

  // designer: activity using short-form ID (3 min ago)
  await db.createActivity({
    sessionId: "session-des-1",
    timestamp: new Date(now - 3 * 60_000).toISOString(),
    actor: { id: "designer", type: "subagent" },
    actionType: "tool_call",
    description: "Creating mockup",
    status: "success",
  });

  // --- LLM generations table seeding ---

  // workspace-reviewer: ONLY has generation data (5 min ago), no activities
  await db.upsertGeneration({
    id: "gen-rev-1",
    sessionLogFile: "reviewer-session.jsonl",
    sessionLogMsgId: 1,
    agentId: "reviewer",
    timestamp: new Date(now - 5 * 60_000).toISOString(),
    model: "claude-sonnet-4.5",
    provider: "anthropic",
    stopReason: "end_turn",
    inputTokens: 1000,
    outputTokens: 500,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 1500,
    costInput: 0.003,
    costOutput: 0.015,
    costCacheRead: 0,
    costTotal: 0.018,
  });

  // workspace-planner: MORE RECENT generation data (3 min ago, vs 20 min in activities)
  await db.upsertGeneration({
    id: "gen-plan-1",
    sessionLogFile: "planner-session.jsonl",
    sessionLogMsgId: 1,
    agentId: "planner",
    timestamp: new Date(now - 3 * 60_000).toISOString(),
    model: "claude-sonnet-4",
    provider: "anthropic",
    stopReason: "end_turn",
    inputTokens: 2000,
    outputTokens: 1000,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 3000,
    costInput: 0.006,
    costOutput: 0.03,
    costCacheRead: 0,
    costTotal: 0.036,
  });

  // workspace-engineer: generation data OLDER than activity (10 min ago)
  await db.upsertGeneration({
    id: "gen-eng-1",
    sessionLogFile: "engineer-session.jsonl",
    sessionLogMsgId: 1,
    agentId: "engineer",
    timestamp: new Date(now - 10 * 60_000).toISOString(),
    model: "claude-sonnet-4.5",
    provider: "anthropic",
    stopReason: "end_turn",
    inputTokens: 3000,
    outputTokens: 2000,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 5000,
    costInput: 0.009,
    costOutput: 0.06,
    costCacheRead: 0,
    costTotal: 0.069,
  });
});

afterAll(async () => {
  delete process.env.AGENT_PATHS;
  if (server) server.close();
  logger.removeAllListeners();
  await db.close().catch(() => {});
  cleanupFixtures();
});

// ===========================================================================
// Tests
// ===========================================================================

describe("ORC-40: Stats lookup ID format", () => {
  // -------------------------------------------------------------------------
  // TC-1: Workspace-prefixed agent IDs resolve to correct stats via GET /api/agents
  // -------------------------------------------------------------------------
  test("TC-1: workspace-prefixed agent IDs get correct stats from activities table", async () => {
    const { status, body } = await api("/api/agents");
    expect(status).toBe(200);
    expect(body.success).toBe(true);

    // The filesystem returns agent.id = "workspace-engineer"
    // buildActivityStatsMap normalizes activity actor "workspace-engineer" → "engineer"
    // The fix: statsMap.get(toActorId("workspace-engineer")) → statsMap.get("engineer")
    const engineer = body.agents.find(
      (a: any) => a.id === "workspace-engineer",
    );
    expect(engineer).toBeDefined();
    expect(engineer.lastActive).toBeTruthy();
    expect(engineer.lastActive).not.toBe("");
    expect(engineer.status).toBe("online"); // activity 2 min ago
    expect(engineer.sessionCount).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // TC-2: Short-form agent IDs still resolve correctly
  // -------------------------------------------------------------------------
  test("TC-2: short-form agent IDs get correct stats", async () => {
    const { body } = await api("/api/agents");

    // designer has activities stored with short-form ID "designer"
    // toActorId("designer") = "designer" (pass-through), so lookup works either way
    const designer = body.agents.find((a: any) => a.id === "designer");
    expect(designer).toBeDefined();
    expect(designer.lastActive).toBeTruthy();
    expect(designer.status).toBe("online"); // activity 3 min ago
    expect(designer.sessionCount).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // TC-3: GET /api/agents/:id with workspace-prefixed ID
  // -------------------------------------------------------------------------
  test("TC-3: GET /api/agents/:id resolves workspace-prefixed ID correctly", async () => {
    const { status, body } = await api("/api/agents/workspace-engineer");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.agent.id).toBe("workspace-engineer");
    expect(body.agent.lastActive).toBeTruthy();
    expect(body.agent.status).toBe("online");
    expect(body.agent.sessionCount).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // TC-4: Agent with activity only in llm_generations gets lastActive (Fix 2)
  // -------------------------------------------------------------------------
  test("TC-4: agent with only llm_generations data shows lastActive", async () => {
    const { body } = await api("/api/agents");

    // workspace-reviewer has NO activities, only llm_generations with agentId="reviewer"
    // buildActivityStatsMap should merge generation timestamp as lastActive
    const reviewer = body.agents.find(
      (a: any) => a.id === "workspace-reviewer",
    );
    expect(reviewer).toBeDefined();
    expect(reviewer.lastActive).toBeTruthy();
    expect(reviewer.lastActive).not.toBe("");
    // 5 min ago → should be online (< 5 min threshold)
    expect(["online", "idle"]).toContain(reviewer.status);
  });

  // -------------------------------------------------------------------------
  // TC-5: Agent with activity in both tables uses the most recent timestamp
  // -------------------------------------------------------------------------
  test("TC-5: agent with both activities and generations uses most recent timestamp", async () => {
    const { body } = await api("/api/agents");

    // workspace-planner: activity at -20 min, generation at -3 min
    // After Fix 2, lastActive should be the generation timestamp (more recent)
    const planner = body.agents.find((a: any) => a.id === "workspace-planner");
    expect(planner).toBeDefined();
    expect(planner.lastActive).toBeTruthy();

    const lastActiveTime = new Date(planner.lastActive).getTime();
    const now = Date.now();
    const minutesAgo = (now - lastActiveTime) / 60_000;

    // Should be ~3 min ago (from generation), not ~20 min (from activity)
    expect(minutesAgo).toBeLessThan(10);
    // Status should reflect recent activity
    expect(["online", "idle"]).toContain(planner.status);
  });

  // -------------------------------------------------------------------------
  // TC-6: Agent with no activity at all is correctly offline
  // -------------------------------------------------------------------------
  test("TC-6: agent with no activity in either table shows offline", async () => {
    const { body } = await api("/api/agents");

    const idle = body.agents.find((a: any) => a.id === "idle-agent");
    expect(idle).toBeDefined();
    expect(idle.lastActive).toBe("");
    expect(idle.status).toBe("offline");
    expect(idle.sessionCount).toBe(0);
  });

  // -------------------------------------------------------------------------
  // TC-7: No regression from ORC-35 — toActorId normalization in stats building
  // -------------------------------------------------------------------------
  test("TC-7: toActorId normalization is applied when building stats map", async () => {
    // Verify toActorId works correctly for all our test IDs
    expect(toActorId("workspace-engineer")).toBe("engineer");
    expect(toActorId("workspace-reviewer")).toBe("reviewer");
    expect(toActorId("workspace-planner")).toBe("planner");
    expect(toActorId("designer")).toBe("designer");
    expect(toActorId("workspace")).toBe("main");

    // Verify the API doesn't crash and returns all agents
    const { status, body } = await api("/api/agents");
    expect(status).toBe(200);
    expect(body.agents.length).toBeGreaterThanOrEqual(5);

    // No agent should have "Invalid Date" in lastActive
    for (const agent of body.agents) {
      if (agent.lastActive) {
        expect(new Date(agent.lastActive).toString()).not.toBe("Invalid Date");
      }
    }
  });

  // -------------------------------------------------------------------------
  // TC-8: GET /api/agents/:id for generation-only agent
  // -------------------------------------------------------------------------
  test("TC-8: GET /api/agents/:id for generation-only agent returns stats", async () => {
    const { status, body } = await api("/api/agents/workspace-reviewer");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.agent.lastActive).toBeTruthy();
    expect(["online", "idle"]).toContain(body.agent.status);
  });
});
