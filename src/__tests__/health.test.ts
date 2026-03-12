/**
 * Health Check Endpoint Test
 * Verifies GET /api/health returns expected response shape
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import express from "express";
import { Database } from "../db/database.js";
import { ActivityLogger } from "../logger/activity-logger.js";
import { setupRoutes } from "../api/routes.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

let fixtureDir: string;
let server: ReturnType<ReturnType<typeof express>["listen"]>;
let baseUrl: string;
let db: Database;
let logger: ActivityLogger;
const originalHome = process.env.HOME;

beforeAll(async () => {
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-health-"));

  // Create minimal agent/skill fixtures required by setupRoutes
  const agentsDir = path.join(fixtureDir, "agents");
  const skillsDir = path.join(fixtureDir, "skills");
  fs.mkdirSync(agentsDir, { recursive: true });
  fs.mkdirSync(skillsDir, { recursive: true });

  process.env.AGENT_PATHS = agentsDir;
  process.env.SKILL_PATH = skillsDir;
  process.env.HOME = fixtureDir;

  const dbPath = path.join(fixtureDir, "test.db");
  db = new Database(dbPath);
  await db.initialize();
  logger = new ActivityLogger(db, { profileId: "default" });

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
});

afterAll(async () => {
  delete process.env.AGENT_PATHS;
  delete process.env.SKILL_PATH;
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

describe("GET /api/health", () => {
  test("should return status 200 with healthy response", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.status).toBe("healthy");
  });

  test("should include a valid ISO timestamp", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    const body = await res.json();

    expect(body.timestamp).toBeTruthy();
    const parsed = new Date(body.timestamp);
    expect(parsed.toISOString()).toBe(body.timestamp);
  });
});
