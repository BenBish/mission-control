/**
 * HTTP Integration Tests: Agent & Skills Endpoints
 * Tests actual HTTP request/response cycle for ORC-18 endpoints
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import express from "express";
import { Database } from "../db/database.js";
import { ActivityLogger } from "../logger/activity-logger.js";
import { setupRoutes } from "../api/routes.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Test fixtures directory
let fixtureDir: string;
let agentsDir: string;
let skillsDir: string;
let dbPath: string;
let server: ReturnType<ReturnType<typeof express>["listen"]>;
let baseUrl: string;
let db: Database;
let logger: ActivityLogger;

/**
 * Create test fixture files so AgentService and SkillsService discover them
 */
function createFixtures() {
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-test-"));
  agentsDir = path.join(fixtureDir, "agents");
  skillsDir = path.join(fixtureDir, "skills");

  // Agent: engineer
  const engineerDir = path.join(agentsDir, "engineer");
  fs.mkdirSync(engineerDir, { recursive: true });
  fs.writeFileSync(
    path.join(engineerDir, "SOUL.md"),
    `# SOUL.md - Test Engineer

## Role
Senior Software Engineer

Model: openrouter/anthropic/claude-sonnet-4.5

GIT_AUTHOR_NAME = Test Engineer
GIT_AUTHOR_EMAIL = engineer@test.local
`,
  );

  // Agent: reviewer
  const reviewerDir = path.join(agentsDir, "reviewer");
  fs.mkdirSync(reviewerDir, { recursive: true });
  fs.writeFileSync(
    path.join(reviewerDir, "SOUL.md"),
    `# SOUL.md - Code Reviewer

## Role
Code Reviewer

Model: openrouter/anthropic/claude-haiku-4.5
`,
  );

  // Skill: github
  const githubSkillDir = path.join(skillsDir, "github");
  fs.mkdirSync(githubSkillDir, { recursive: true });
  fs.writeFileSync(
    path.join(githubSkillDir, "SKILL.md"),
    `# GitHub Integration

Manage pull requests and issues via the GitHub CLI.

## Usage
Use gh commands for PR and issue management.
`,
  );

  // Skill: deploy
  const deploySkillDir = path.join(skillsDir, "deploy");
  fs.mkdirSync(deploySkillDir, { recursive: true });
  fs.writeFileSync(
    path.join(deploySkillDir, "SKILL.md"),
    `# Deploy

Deploy applications to production environments.
`,
  );
}

function cleanupFixtures() {
  if (fixtureDir && fs.existsSync(fixtureDir)) {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
}

beforeAll(async () => {
  createFixtures();

  // Point services at our fixture directories
  process.env.AGENT_PATHS = agentsDir;
  process.env.SKILL_PATH = skillsDir;

  // Set up database in temp dir, logger, express app
  dbPath = path.join(fixtureDir, "test.db");
  db = new Database(dbPath);
  await db.initialize();

  logger = new ActivityLogger(db);

  const app = express();
  app.use(express.json());
  setupRoutes(app, logger);

  // Start on random port
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
  delete process.env.AGENT_PATHS;
  delete process.env.SKILL_PATH;

  if (server) server.close();
  logger.removeAllListeners();
  await db.close().catch(() => {});
  cleanupFixtures();
});

// Helper
async function api(urlPath: string) {
  const res = await fetch(`${baseUrl}${urlPath}`);
  let body: any;
  try {
    body = await res.json();
  } catch {
    body = { _raw: await res.text() };
  }
  return { status: res.status, body };
}

// =============================================================================
// GET /api/agents
// =============================================================================

describe("GET /api/agents", () => {
  test("should return list of agents", async () => {
    const { status, body } = await api("/api/agents");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.agents)).toBe(true);
    expect(body.count).toBeGreaterThanOrEqual(2);

    const ids = body.agents.map((a: any) => a.id);
    expect(ids).toContain("engineer");
    expect(ids).toContain("reviewer");
  });

  test("agents should have expected shape with activity stats", async () => {
    const { body } = await api("/api/agents");
    const engineer = body.agents.find((a: any) => a.id === "engineer");
    expect(engineer).toBeDefined();
    expect(engineer.role).toBe("Senior Software Engineer");
    expect(engineer.model).toContain("sonnet");
    expect(engineer.gitAuthorName).toBe("Test Engineer");
    expect(engineer.gitAuthorEmail).toBe("engineer@test.local");
    // Activity stats should be present with defaults (no activity seeded yet)
    expect(engineer.status).toBe("offline");
    expect(engineer.lastActive).toBe("");
    expect(engineer.sessionCount).toBe(0);
    expect(engineer.totalCost).toBe(0);
    expect(engineer.totalTokens).toBe(0);
  });

  test("agents should reflect seeded activity stats", async () => {
    // Seed activity data for the engineer agent
    const now = new Date();
    await db.createActivity({
      sessionId: "test-session-1",
      timestamp: new Date(now.getTime() - 2 * 60 * 1000).toISOString(), // 2 min ago
      actor: { id: "engineer", type: "subagent" },
      actionType: "tool_call",
      description: "test activity 1",
      status: "success",
    });
    await db.createActivity({
      sessionId: "test-session-2",
      timestamp: new Date(now.getTime() - 3 * 60 * 1000).toISOString(), // 3 min ago
      actor: { id: "engineer", type: "subagent" },
      actionType: "tool_call",
      description: "test activity 2",
      status: "success",
    });

    // Update one activity with cost/tokens
    const activities = await db.getActivities({
      actorId: "engineer",
      limit: 1,
    });
    await db.updateActivity(activities[0].id, {
      cost: { usd: 0.05 },
      tokens: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    });

    const { body } = await api("/api/agents");
    const engineer = body.agents.find((a: any) => a.id === "engineer");
    expect(engineer).toBeDefined();
    expect(engineer.status).toBe("online"); // activity within last 5 min
    expect(engineer.lastActive).toBeTruthy();
    expect(engineer.sessionCount).toBe(2);
    expect(engineer.totalCost).toBeGreaterThan(0);
    expect(engineer.totalTokens).toBeGreaterThan(0);
  });
});

// =============================================================================
// GET /api/agents/:id
// =============================================================================

describe("GET /api/agents/:id", () => {
  test("should return a specific agent", async () => {
    const { status, body } = await api("/api/agents/engineer");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.agent.id).toBe("engineer");
    expect(body.agent.role).toBe("Senior Software Engineer");
  });

  test("should return 404 for non-existent agent", async () => {
    const { status, body } = await api("/api/agents/nonexistent-agent");
    expect(status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error).toContain("not found");
  });

  test("should return 400 for invalid agent ID with special characters", async () => {
    const { status, body } = await api("/api/agents/bad!agent");
    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain("Invalid");
  });

  test("should reject IDs with spaces", async () => {
    const { status } = await api("/api/agents/bad%20agent");
    expect(status).toBe(400);
  });
});

// =============================================================================
// GET /api/agents/:id/soul
// =============================================================================

describe("GET /api/agents/:id/soul", () => {
  test("should return raw SOUL.md content", async () => {
    const { status, body } = await api("/api/agents/engineer/soul");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.content).toContain("Senior Software Engineer");
    expect(body.content).toContain("GIT_AUTHOR_NAME");
  });

  test("should return 404 for non-existent agent soul", async () => {
    const { status, body } = await api("/api/agents/nonexistent-agent/soul");
    expect(status).toBe(404);
    expect(body.success).toBe(false);
  });

  test("should return 400 for invalid ID", async () => {
    const { status } = await api("/api/agents/bad!id/soul");
    expect(status).toBe(400);
  });
});

// =============================================================================
// GET /api/agents/:id/activity
// =============================================================================

describe("GET /api/agents/:id/activity", () => {
  test("should return activities array (empty for new agent)", async () => {
    const { status, body } = await api("/api/agents/engineer/activity");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.activities)).toBe(true);
    expect(typeof body.count).toBe("number");
  });

  test("should respect limit query param", async () => {
    const { status, body } = await api("/api/agents/engineer/activity?limit=5");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.activities.length).toBeLessThanOrEqual(5);
  });

  test("should return 400 for invalid ID", async () => {
    const { status } = await api("/api/agents/bad!id/activity");
    expect(status).toBe(400);
  });
});

// =============================================================================
// GET /api/agents/:id/skills
// =============================================================================

describe("GET /api/agents/:id/skills", () => {
  test("should return skills array for existing agent", async () => {
    const { status, body } = await api("/api/agents/engineer/skills");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.skills)).toBe(true);
    expect(typeof body.count).toBe("number");
  });

  test("should return 404 for non-existent agent", async () => {
    const { status, body } = await api("/api/agents/nonexistent-agent/skills");
    expect(status).toBe(404);
    expect(body.success).toBe(false);
  });

  test("should return 400 for invalid ID", async () => {
    const { status } = await api("/api/agents/bad!id/skills");
    expect(status).toBe(400);
  });
});

// =============================================================================
// GET /api/skills
// =============================================================================

describe("GET /api/skills", () => {
  test("should return list of skills", async () => {
    const { status, body } = await api("/api/skills");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.skills)).toBe(true);
    expect(body.count).toBeGreaterThanOrEqual(2);

    const ids = body.skills.map((s: any) => s.id);
    expect(ids).toContain("github");
    expect(ids).toContain("deploy");
  });

  test("skills should have expected shape", async () => {
    const { body } = await api("/api/skills");
    const github = body.skills.find((s: any) => s.id === "github");
    expect(github).toBeDefined();
    expect(github.name).toBeDefined();
    expect(github.description).toContain("pull requests");
  });

  test("skills should not expose filesystem location", async () => {
    const { body } = await api("/api/skills");
    for (const skill of body.skills) {
      expect(skill.location).toBeUndefined();
    }
  });
});

// =============================================================================
// GET /api/skills/:id
// =============================================================================

describe("GET /api/skills/:id", () => {
  test("should return a specific skill", async () => {
    const { status, body } = await api("/api/skills/github");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.skill.id).toBe("github");
    expect(body.skill.location).toBeUndefined();
  });

  test("should return 404 for non-existent skill", async () => {
    const { status, body } = await api("/api/skills/nonexistent-skill");
    expect(status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error).toContain("not found");
  });

  test("should return 400 for invalid ID", async () => {
    const { status, body } = await api("/api/skills/bad!id");
    expect(status).toBe(400);
    expect(body.success).toBe(false);
  });
});

// =============================================================================
// GET /api/permissions/matrix
// =============================================================================

describe("GET /api/permissions/matrix", () => {
  test("should return permissions matrix", async () => {
    const { status, body } = await api("/api/permissions/matrix");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.agents)).toBe(true);
    expect(Array.isArray(body.skills)).toBe(true);
    expect(Array.isArray(body.matrix)).toBe(true);
  });

  test("matrix dimensions should match agents × skills", async () => {
    const { body } = await api("/api/permissions/matrix");
    expect(body.matrix.length).toBe(body.agents.length);
    for (const row of body.matrix) {
      expect(row.length).toBe(body.skills.length);
    }
  });

  test("matrix values should be booleans", async () => {
    const { body } = await api("/api/permissions/matrix");
    for (const row of body.matrix) {
      for (const cell of row) {
        expect(typeof cell).toBe("boolean");
      }
    }
  });
});
