/**
 * Agent usage API routes (BSH-99).
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import express from "express";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Database } from "../../db/database.js";
import { setupRoutes } from "../../server/routes/index.js";

let fixtureDir: string;
let server: ReturnType<ReturnType<typeof express>["listen"]>;
let baseUrl: string;
let db: Database;

beforeAll(async () => {
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-agent-usage-"));
  db = new Database(path.join(fixtureDir, "test.db"));
  await db.initialize();

  const raw = db.raw();
  // Ensure source + instance exist (seed may already add them; upsert safely)
  await raw.run(
    `INSERT OR IGNORE INTO sources (id, name, kind, default_unit) VALUES (?, ?, ?, ?)`,
    "claude-code",
    "Claude Code",
    "agentic",
    "quota",
  );
  await raw.run(
    `INSERT OR IGNORE INTO source_instances (
      id, source_id, machine, collector_kind, status
    ) VALUES (?, ?, ?, ?, ?)`,
    "claude-code@test",
    "claude-code",
    "test",
    "jsonl-push",
    "ok",
  );
  await raw.run(
    `INSERT INTO sessions (
      id, source_id, instance_id, external_id, cwd, title, started_at,
      input_tokens, output_tokens, cache_read_tokens, cache_write_tokens
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    "claude-code:s1",
    "claude-code",
    "claude-code@test",
    "s1",
    "/home/ben/Dev/mission-control",
    "Work session",
    "2026-08-05T10:00:00.000Z",
    100,
    50,
    10,
    5,
  );
  await raw.run(
    `INSERT INTO activities (
      id, source_id, instance_id, session_id, timestamp,
      actor_type, actor_id, action_type, description, status,
      input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, model
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    "act-1",
    "claude-code",
    "claude-code@test",
    "claude-code:s1",
    "2026-08-05T10:05:00.000Z",
    "agent",
    "main",
    "message",
    "hello",
    "success",
    1000,
    200,
    50,
    10,
    "claude-3-5-sonnet-20241022",
  );
  await raw.run(
    `INSERT INTO activities (
      id, source_id, instance_id, session_id, timestamp,
      actor_type, actor_id, action_type, description, status,
      input_tokens, output_tokens, model
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    "act-2",
    "claude-code",
    "claude-code@test",
    "claude-code:s1",
    "2026-08-05T10:06:00.000Z",
    "agent",
    "main",
    "message",
    "synth",
    "success",
    0,
    0,
    "<synthetic>",
  );
  await raw.run(
    `INSERT INTO activities (
      id, source_id, instance_id, session_id, timestamp,
      actor_type, actor_id, action_type, description, status,
      input_tokens, output_tokens, model
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    "act-3",
    "claude-code",
    "claude-code@test",
    "claude-code:s1",
    "2026-08-05T10:07:00.000Z",
    "agent",
    "main",
    "message",
    "unk",
    "success",
    500,
    0,
    "unknown",
  );

  const app = express();
  app.use(express.json());
  setupRoutes(app, db);

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
  if (server) server.close();
  await db.close().catch(() => {});
  if (fixtureDir) fs.rmSync(fixtureDir, { recursive: true, force: true });
});

describe("GET /api/consumption/agent-usage", () => {
  test("returns camelCase summary with coverage and ranked drivers", async () => {
    const res = await fetch(
      `${baseUrl}/api/consumption/agent-usage?since=2026-08-01T00:00:00.000Z`,
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.source).toBe("agent-usage");
    expect(body.totals.inputTokens).toBeGreaterThan(0);
    expect(body.coverage.unattributedTokens).toBeGreaterThan(0);
    expect(body.coverage.unattributedPct).toBeGreaterThan(0);
    // Default excludes synthetic/zero/unknown model rows from ranking
    expect(
      body.drivers.every(
        (d: { attribution: string; materiality: string }) =>
          d.attribution === "known" && d.materiality === "material",
      ),
    ).toBe(true);
    expect(body.drivers[0].canonicalModel).toBe("claude-3.5-sonnet");
    expect(body.drivers[0].rawModels).toContain("claude-3-5-sonnet-20241022");
    expect(body.drivers[0].project).toBe("mission-control");
    // No full path leakage
    expect(JSON.stringify(body)).not.toContain("/home/ben/Dev");
  });

  test("includeNonMaterial adds zero/synthetic", async () => {
    const res = await fetch(
      `${baseUrl}/api/consumption/agent-usage?includeNonMaterial=1`,
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.includeNonMaterial).toBe(true);
  });

  test("supports until range bound", async () => {
    const res = await fetch(
      `${baseUrl}/api/consumption/agent-usage?since=2026-08-05T00:00:00.000Z&until=2026-08-05T23:59:59.000Z`,
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.range.since).toBe("2026-08-05T00:00:00.000Z");
    expect(body.range.until).toBe("2026-08-05T23:59:59.000Z");
  });
});

describe("GET /api/consumption/agent-usage/sessions", () => {
  test("requires driverKey", async () => {
    const res = await fetch(
      `${baseUrl}/api/consumption/agent-usage/sessions?dimension=model`,
    );
    expect(res.status).toBe(400);
  });

  test("drill-down returns sessions for a driver", async () => {
    const summaryRes = await fetch(`${baseUrl}/api/consumption/agent-usage`);
    const summary = await summaryRes.json();
    const key = summary.drivers[0].key as string;
    const res = await fetch(
      `${baseUrl}/api/consumption/agent-usage/sessions?dimension=model&driverKey=${encodeURIComponent(key)}`,
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.sessions.length).toBeGreaterThanOrEqual(1);
    expect(body.sessions[0].project).toBe("mission-control");
    expect(body.sessions[0].sessionId).toBe("claude-code:s1");
  });
});
