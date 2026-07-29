/**
 * Source-scope API integration tests — failures, jobs, generations, and
 * activities honor ?sourceId= filtering in SQL (not post-slice).
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
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-source-scope-"));
  db = new Database(path.join(fixtureDir, "test.db"));
  await db.initialize();

  const raw = db.raw();
  const now = new Date().toISOString();

  // Use seeded source_instances (FK). Multiple sources with failures.
  for (const [sourceId, instanceId, activityId] of [
    ["claude-code", "claude-code@arch-desktop", "act-cc-fail"],
    ["hermes", "hermes@strix-halo", "act-hermes-fail"],
    ["grok", "grok@arch-desktop", "act-grok-fail"],
  ] as const) {
    await raw.run(
      `INSERT INTO sessions (
        id, source_id, instance_id, external_id, started_at,
        turn_count, tool_call_count, failure_count
      ) VALUES (?, ?, ?, ?, ?, 1, 0, 1)`,
      `${sourceId}:sess`,
      sourceId,
      instanceId,
      "sess",
      now,
    );
    await raw.run(
      `INSERT INTO activities (
        id, source_id, instance_id, session_id, external_id, timestamp,
        actor_type, actor_id, action_type, description, status
      ) VALUES (?, ?, ?, ?, ?, ?, 'agent', 'a', 'tool_call', ?, 'failure')`,
      activityId,
      sourceId,
      instanceId,
      `${sourceId}:sess`,
      `ext-${activityId}`,
      now,
      `${sourceId} failure`,
    );
  }

  await raw.run(
    `INSERT INTO background_jobs (id, source_id, name, kind, enabled)
     VALUES (?, 'claude-code', 'CC collector', 'collector', 1)`,
    "job-cc",
  );
  await raw.run(
    `INSERT INTO background_jobs (id, source_id, name, kind, enabled)
     VALUES (?, 'hermes', 'Hermes job', 'scheduled', 1)`,
    "job-hermes",
  );

  await raw.run(
    `INSERT INTO generation_jobs (
      id, source_id, instance_id, external_id, status, first_seen_at
    ) VALUES (?, 'comfyui', 'comfyui@strix-halo', 'gen-1', 'success', ?)`,
    "comfyui:comfyui@strix-halo:gen-1",
    now,
  );
  await raw.run(
    `INSERT INTO generation_jobs (
      id, source_id, instance_id, external_id, status, first_seen_at
    ) VALUES (?, 'claude-code', 'claude-code@arch-desktop', 'gen-2', 'success', ?)`,
    "claude-code:claude-code@arch-desktop:gen-2",
    now,
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

async function getJson(pathAndQuery: string) {
  const res = await fetch(`${baseUrl}${pathAndQuery}`);
  expect(res.ok).toBe(true);
  return res.json();
}

describe("source-scoped list endpoints", () => {
  test("GET /api/failures filters by sourceId in SQL", async () => {
    const all = await getJson("/api/failures?limit=20");
    expect(all.success).toBe(true);
    expect(all.failures.length).toBeGreaterThanOrEqual(3);

    const hermes = await getJson("/api/failures?limit=20&sourceId=hermes");
    expect(hermes.failures.length).toBe(1);
    expect(hermes.failures[0].sourceId).toBe("hermes");
    expect(hermes.failures[0].summary).toContain("hermes");

    const grok = await getJson("/api/failures?limit=5&sourceId=grok");
    expect(
      grok.failures.every((f: { sourceId: string }) => f.sourceId === "grok"),
    ).toBe(true);
    expect(grok.failures.length).toBe(1);
  });

  test("GET /api/activities filters by sourceId", async () => {
    const body = await getJson("/api/activities?limit=50&sourceId=claude-code");
    expect(body.success).toBe(true);
    expect(body.activities.length).toBeGreaterThan(0);
    expect(
      body.activities.every(
        (a: { sourceId: string }) => a.sourceId === "claude-code",
      ),
    ).toBe(true);
  });

  test("GET /api/jobs filters by sourceId", async () => {
    const all = await getJson("/api/jobs");
    expect(all.jobs.length).toBeGreaterThanOrEqual(2);

    const cc = await getJson("/api/jobs?sourceId=claude-code");
    expect(cc.jobs).toHaveLength(1);
    expect(cc.jobs[0].sourceId).toBe("claude-code");
  });

  test("GET /api/generations filters by sourceId", async () => {
    const comfy = await getJson("/api/generations?sourceId=comfyui");
    expect(comfy.jobs).toHaveLength(1);
    expect(comfy.jobs[0].sourceId).toBe("comfyui");

    const empty = await getJson("/api/generations?sourceId=hermes");
    expect(empty.jobs).toHaveLength(0);
  });

  test("GET /api/consumption accepts sourceId without error", async () => {
    const body = await getJson("/api/consumption?sourceId=claude-code");
    expect(body.success).toBe(true);
    expect(Array.isArray(body.consumption)).toBe(true);
  });
});
