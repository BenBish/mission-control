/**
 * Failures API — aggregate summary independent of paginated rows.
 * Covers empty, partial-page, and multi-page (saturated limit) datasets.
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
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Database } from "../../db/database.js";
import { setupRoutes } from "../../server/routes/index.js";

let fixtureDir: string;
let server: ReturnType<ReturnType<typeof express>["listen"]>;
let baseUrl: string;
let db: Database;

const CC_INSTANCE = "claude-code@arch-desktop";
const HERMES_INSTANCE = "hermes@strix-halo";

beforeAll(async () => {
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-failures-"));
  db = new Database(path.join(fixtureDir, "test.db"));
  await db.initialize();

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

beforeEach(async () => {
  const raw = db.raw();
  await raw.run("DELETE FROM activities");
  await raw.run("DELETE FROM sessions");
  await raw.run("DELETE FROM inference_requests");
  await raw.run("DELETE FROM runtime_events");
});

async function getJson(pathAndQuery: string) {
  const res = await fetch(`${baseUrl}${pathAndQuery}`);
  expect(res.ok).toBe(true);
  return res.json() as Promise<{
    success: boolean;
    failures: Array<{
      kind: string;
      id: string;
      sourceId: string;
      timestamp: string;
      summary: string;
    }>;
    summary: {
      total: number;
      last24Hours: number;
      openRuntimeEvents: number;
      byKind: {
        activity: number;
        inference_request: number;
        runtime_event: number;
      };
      definitions: Record<string, string>;
    };
  }>;
}

async function ensureSession(sourceId: string, instanceId: string) {
  const raw = db.raw();
  const id = `${sourceId}:sess`;
  const existing = await raw.get("SELECT id FROM sessions WHERE id = ?", id);
  if (existing) return id;
  await raw.run(
    `INSERT INTO sessions (
      id, source_id, instance_id, external_id, started_at,
      turn_count, tool_call_count, failure_count
    ) VALUES (?, ?, ?, ?, ?, 1, 0, 0)`,
    id,
    sourceId,
    instanceId,
    "sess",
    new Date().toISOString(),
  );
  return id;
}

async function insertActivityFailure(opts: {
  id: string;
  sourceId?: string;
  instanceId?: string;
  timestamp: string;
  description?: string;
}) {
  const sourceId = opts.sourceId ?? "claude-code";
  const instanceId = opts.instanceId ?? CC_INSTANCE;
  const sessionId = await ensureSession(sourceId, instanceId);
  await db.raw().run(
    `INSERT INTO activities (
      id, source_id, instance_id, session_id, external_id, timestamp,
      actor_type, actor_id, action_type, description, status
    ) VALUES (?, ?, ?, ?, ?, ?, 'agent', 'a', 'tool_call', ?, 'failure')`,
    opts.id,
    sourceId,
    instanceId,
    sessionId,
    `ext-${opts.id}`,
    opts.timestamp,
    opts.description ?? `failure ${opts.id}`,
  );
}

async function insertInferenceFailure(opts: {
  id: string;
  sourceId?: string;
  instanceId?: string;
  timestamp: string;
}) {
  const sourceId = opts.sourceId ?? "hermes";
  const instanceId = opts.instanceId ?? HERMES_INSTANCE;
  await db.raw().run(
    `INSERT INTO inference_requests (
      id, source_id, instance_id, timestamp, model, client_label, status, error
    ) VALUES (?, ?, ?, ?, 'test-model', 'test-client', 'error', 'boom')`,
    opts.id,
    sourceId,
    instanceId,
    opts.timestamp,
  );
}

async function insertRuntimeEvent(opts: {
  id: string;
  sourceId?: string;
  instanceId?: string;
  timestamp: string;
  endedAt?: string | null;
  severity?: string;
}) {
  const sourceId = opts.sourceId ?? "hermes";
  const instanceId = opts.instanceId ?? HERMES_INSTANCE;
  await db.raw().run(
    `INSERT INTO runtime_events (
      id, source_id, instance_id, timestamp, ended_at, kind, severity, summary
    ) VALUES (?, ?, ?, ?, ?, 'slots_saturated', ?, 'saturated')`,
    opts.id,
    sourceId,
    instanceId,
    opts.timestamp,
    opts.endedAt ?? null,
    opts.severity ?? "warning",
  );
}

describe("GET /api/failures summary aggregates", () => {
  test("empty dataset: zero totals and empty page", async () => {
    const body = await getJson("/api/failures?limit=50");
    expect(body.success).toBe(true);
    expect(body.failures).toEqual([]);
    expect(body.summary.total).toBe(0);
    expect(body.summary.last24Hours).toBe(0);
    expect(body.summary.openRuntimeEvents).toBe(0);
    expect(body.summary.byKind).toEqual({
      activity: 0,
      inference_request: 0,
      runtime_event: 0,
    });
    expect(body.summary.definitions.statusScope).toContain("activity failure");
  });

  test("partial page: total matches row count when under limit", async () => {
    const now = new Date().toISOString();
    await insertActivityFailure({ id: "act-1", timestamp: now });
    await insertActivityFailure({ id: "act-2", timestamp: now });
    await insertInferenceFailure({ id: "inf-1", timestamp: now });

    const body = await getJson("/api/failures?limit=50");
    expect(body.failures).toHaveLength(3);
    expect(body.summary.total).toBe(3);
    expect(body.summary.last24Hours).toBe(3);
    expect(body.summary.byKind.activity).toBe(2);
    expect(body.summary.byKind.inference_request).toBe(1);
    expect(body.summary.byKind.runtime_event).toBe(0);
  });

  test("multi-page: total exceeds limit; page length stays capped", async () => {
    const now = new Date().toISOString();
    for (let i = 0; i < 12; i++) {
      await insertActivityFailure({
        id: `act-mp-${i}`,
        timestamp: now,
      });
    }

    const body = await getJson("/api/failures?limit=5");
    expect(body.failures).toHaveLength(5);
    expect(body.summary.total).toBe(12);
    expect(body.summary.last24Hours).toBe(12);
    // Must not report page length as the total
    expect(body.summary.total).not.toBe(body.failures.length);
  });

  test("last24Hours excludes older failures while total includes them", async () => {
    const now = new Date();
    const recent = now.toISOString();
    const old = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();

    await insertActivityFailure({ id: "act-recent", timestamp: recent });
    await insertActivityFailure({ id: "act-old", timestamp: old });
    await insertInferenceFailure({ id: "inf-old", timestamp: old });
    await insertRuntimeEvent({ id: "rt-recent", timestamp: recent });

    const body = await getJson("/api/failures?limit=50");
    expect(body.summary.total).toBe(4);
    expect(body.summary.last24Hours).toBe(2);
    expect(body.summary.byKind.activity).toBe(2);
    expect(body.summary.byKind.inference_request).toBe(1);
    expect(body.summary.byKind.runtime_event).toBe(1);
  });

  test("openRuntimeEvents counts only unresolved non-info runtime events", async () => {
    const now = new Date().toISOString();
    await insertRuntimeEvent({
      id: "rt-open",
      timestamp: now,
      endedAt: null,
      severity: "error",
    });
    await insertRuntimeEvent({
      id: "rt-closed",
      timestamp: now,
      endedAt: now,
      severity: "warning",
    });
    await insertRuntimeEvent({
      id: "rt-info",
      timestamp: now,
      endedAt: null,
      severity: "info",
    });

    const body = await getJson("/api/failures?limit=50");
    // info is excluded from failure totals entirely
    expect(body.summary.total).toBe(2);
    expect(body.summary.openRuntimeEvents).toBe(1);
    expect(body.summary.byKind.runtime_event).toBe(2);
  });

  test("sourceId filters both page rows and summary totals", async () => {
    const now = new Date().toISOString();
    await insertActivityFailure({
      id: "act-cc",
      sourceId: "claude-code",
      instanceId: CC_INSTANCE,
      timestamp: now,
    });
    await insertActivityFailure({
      id: "act-hermes",
      sourceId: "hermes",
      instanceId: HERMES_INSTANCE,
      timestamp: now,
    });
    await insertInferenceFailure({
      id: "inf-hermes",
      sourceId: "hermes",
      instanceId: HERMES_INSTANCE,
      timestamp: now,
    });

    const all = await getJson("/api/failures?limit=50");
    expect(all.summary.total).toBe(3);

    const hermes = await getJson("/api/failures?limit=50&sourceId=hermes");
    expect(hermes.failures).toHaveLength(2);
    expect(hermes.failures.every((f) => f.sourceId === "hermes")).toBe(true);
    expect(hermes.summary.total).toBe(2);
    expect(hermes.summary.last24Hours).toBe(2);
    expect(hermes.summary.byKind.activity).toBe(1);
    expect(hermes.summary.byKind.inference_request).toBe(1);

    const cc = await getJson("/api/failures?limit=1&sourceId=claude-code");
    expect(cc.failures).toHaveLength(1);
    expect(cc.summary.total).toBe(1);
  });
});
