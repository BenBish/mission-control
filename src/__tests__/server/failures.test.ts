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

type FailuresBody = {
  success: boolean;
  error?: string;
  failures?: Array<{
    kind: string;
    id: string;
    sourceId: string;
    timestamp: string;
    summary: string;
  }>;
  summary?: {
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
};

async function getJson(pathAndQuery: string) {
  const res = await fetch(`${baseUrl}${pathAndQuery}`);
  expect(res.ok).toBe(true);
  return res.json() as Promise<FailuresBody & { success: true }>;
}

async function getJsonStatus(pathAndQuery: string) {
  const res = await fetch(`${baseUrl}${pathAndQuery}`);
  const body = (await res.json()) as FailuresBody;
  return { status: res.status, body };
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
  kind?: string;
  summary?: string;
  details?: string | null;
}) {
  const sourceId = opts.sourceId ?? "hermes";
  const instanceId = opts.instanceId ?? HERMES_INSTANCE;
  await db.raw().run(
    `INSERT INTO runtime_events (
      id, source_id, instance_id, timestamp, ended_at, kind, severity, summary, details
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    opts.id,
    sourceId,
    instanceId,
    opts.timestamp,
    opts.endedAt ?? null,
    opts.kind ?? "slots_saturated",
    opts.severity ?? "warning",
    opts.summary ?? "saturated",
    opts.details ?? null,
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

describe("GET /api/failures invalid query (BSH-79)", () => {
  test("limit=notanumber returns 400 JSON and keeps server alive", async () => {
    const bad = await getJsonStatus("/api/failures?limit=notanumber");
    expect(bad.status).toBe(400);
    expect(bad.body.success).toBe(false);
    expect(bad.body.error).toMatch(/limit/i);

    // Process must still serve subsequent requests
    const healthy = await getJsonStatus("/api/failures?limit=5");
    expect(healthy.status).toBe(200);
    expect(healthy.body.success).toBe(true);
    expect(Array.isArray(healthy.body.failures)).toBe(true);
    expect(healthy.body.summary).toBeDefined();
  });

  test("non-positive and non-integer limits are rejected", async () => {
    for (const limit of ["0", "-3", "1.5", "NaN", "Infinity"]) {
      const res = await getJsonStatus(`/api/failures?limit=${limit}`);
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/limit/i);
    }
  });

  test("huge limit is clamped and still returns 200 (not crash)", async () => {
    const res = await getJsonStatus("/api/failures?limit=1000000000");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.failures)).toBe(true);
    // Clamped to MAX_QUERY_LIMIT (1000); empty fixture has 0 rows
    expect(res.body.failures!.length).toBeLessThanOrEqual(1000);
  });

  test("repeated sourceId (array) returns 400 without crashing", async () => {
    const res = await getJsonStatus(
      "/api/failures?sourceId=hermes&sourceId=grok",
    );
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/sourceId/i);

    const ok = await getJsonStatus("/api/failures?limit=1");
    expect(ok.status).toBe(200);
    expect(ok.body.success).toBe(true);
  });

  test("after bad limit, multi-page totals still exceed page length", async () => {
    const now = new Date().toISOString();
    for (let i = 0; i < 8; i++) {
      await insertActivityFailure({
        id: `act-bsh79-${i}`,
        timestamp: now,
      });
    }

    const bad = await getJsonStatus("/api/failures?limit=notanumber");
    expect(bad.status).toBe(400);

    const body = await getJson("/api/failures?limit=3");
    expect(body.failures).toHaveLength(3);
    expect(body.summary.total).toBe(8);
    expect(body.summary.total).not.toBe(body.failures!.length);
  });
});

type GroupsBody = {
  success: boolean;
  error?: string;
  groups?: Array<{
    fingerprint: string;
    kind: string;
    sourceId: string;
    summary: string;
    occurrenceCount: number;
    firstSeen: string;
    lastSeen: string;
    resolved: boolean;
    openCount: number;
  }>;
  groupTotal?: number;
  summary?: {
    total: number;
    last24Hours: number;
    openRuntimeEvents: number;
    byKind: {
      activity: number;
      inference_request: number;
      runtime_event: number;
    };
  };
};

type GroupEventsBody = {
  success: boolean;
  error?: string;
  fingerprint?: string;
  events?: Array<{ id: string; kind: string; fingerprint?: string }>;
  total?: number;
};

async function getGroups(pathAndQuery: string) {
  const res = await fetch(`${baseUrl}${pathAndQuery}`);
  const body = (await res.json()) as GroupsBody;
  return { status: res.status, body };
}

describe("GET /api/failures/groups (BSH-72)", () => {
  test("groups repeated slot-saturation into one row with occurrence count", async () => {
    const t1 = "2026-07-21T01:00:00.000Z";
    const t2 = "2026-07-21T02:00:00.000Z";
    const t3 = "2026-07-21T03:00:00.000Z";
    await insertRuntimeEvent({
      id: "rt-1",
      timestamp: t1,
      kind: "slots_saturated",
      summary: "slots saturated",
    });
    await insertRuntimeEvent({
      id: "rt-2",
      timestamp: t2,
      kind: "slots_saturated",
      summary: "slots saturated",
    });
    await insertRuntimeEvent({
      id: "rt-3",
      timestamp: t3,
      kind: "slots_saturated",
      summary: "slots saturated",
      endedAt: t3,
    });

    const { status, body } = await getGroups("/api/failures/groups?limit=50");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.summary?.total).toBe(3);
    expect(body.groupTotal).toBe(1);
    expect(body.groups).toHaveLength(1);
    const g = body.groups![0];
    expect(g.kind).toBe("runtime_event");
    expect(g.sourceId).toBe("hermes");
    expect(g.occurrenceCount).toBe(3);
    expect(g.firstSeen).toBe(t1);
    expect(g.lastSeen).toBe(t3);
    // One occurrence still open (rt-1, rt-2 open; rt-3 resolved)
    expect(g.resolved).toBe(false);
    expect(g.openCount).toBe(2);
  });

  test("cancellation events with varying UUIDs collapse via normalization", async () => {
    const now = new Date().toISOString();
    await insertRuntimeEvent({
      id: "c1",
      timestamp: now,
      kind: "request_cancelled",
      summary:
        "cancelled 550e8400-e29b-41d4-a716-446655440000 at 2026-07-21T01:08:48.080Z",
    });
    await insertRuntimeEvent({
      id: "c2",
      timestamp: now,
      kind: "request_cancelled",
      summary:
        "cancelled 660e8400-e29b-41d4-a716-446655440099 at 2026-07-22T11:00:00.000Z",
    });

    const { status, body } = await getGroups(
      "/api/failures/groups?kind=runtime_event",
    );
    expect(status).toBe(200);
    expect(body.groupTotal).toBe(1);
    expect(body.groups![0].occurrenceCount).toBe(2);
  });

  test("filters by kind and resolved status; summary stays event-level", async () => {
    const now = new Date().toISOString();
    await insertRuntimeEvent({
      id: "open-1",
      timestamp: now,
      endedAt: null,
      summary: "slots saturated",
    });
    await insertRuntimeEvent({
      id: "closed-1",
      timestamp: now,
      endedAt: now,
      summary: "slots saturated",
    });
    await insertActivityFailure({ id: "act-1", timestamp: now });

    const all = await getGroups("/api/failures/groups?limit=50");
    expect(all.body.summary?.total).toBe(3);
    // open runtime + closed runtime share fingerprint → 1 group; activity → 1
    expect(all.body.groupTotal).toBe(2);

    const unresolved = await getGroups(
      "/api/failures/groups?resolved=unresolved",
    );
    expect(unresolved.status).toBe(200);
    // Activity always unresolved; runtime group has openCount > 0 → both
    expect(unresolved.body.groupTotal).toBe(2);
    expect(unresolved.body.summary?.total).toBe(3);

    const resolvedOnly = await getGroups(
      "/api/failures/groups?resolved=resolved",
    );
    // Group still open because one occurrence is open
    expect(resolvedOnly.body.groupTotal).toBe(0);

    const kindOnly = await getGroups("/api/failures/groups?kind=activity");
    expect(kindOnly.body.groupTotal).toBe(1);
    expect(kindOnly.body.groups![0].kind).toBe("activity");
    // Summary is still all events (source unscoped), not kind-filtered
    expect(kindOnly.body.summary?.total).toBe(3);
  });

  test("group pagination is independent of event totals", async () => {
    const now = new Date().toISOString();
    // 5 distinct activity descriptions → 5 groups
    for (let i = 0; i < 5; i++) {
      await insertActivityFailure({
        id: `act-g-${i}`,
        timestamp: now,
        description: `unique failure ${i}`,
      });
    }
    // Extra repeats on first description → still 5 groups, 7 events
    await insertActivityFailure({
      id: "act-g-0b",
      timestamp: now,
      description: "unique failure 0",
    });
    await insertActivityFailure({
      id: "act-g-0c",
      timestamp: now,
      description: "unique failure 0",
    });

    const page1 = await getGroups("/api/failures/groups?limit=2&offset=0");
    expect(page1.body.groups).toHaveLength(2);
    expect(page1.body.groupTotal).toBe(5);
    expect(page1.body.summary?.total).toBe(7);

    const page2 = await getGroups("/api/failures/groups?limit=2&offset=2");
    expect(page2.body.groups).toHaveLength(2);
    expect(page2.body.groupTotal).toBe(5);

    const page3 = await getGroups("/api/failures/groups?limit=2&offset=4");
    expect(page3.body.groups).toHaveLength(1);
  });

  test("invalid kind / resolved / offset return 400", async () => {
    const badKind = await getGroups("/api/failures/groups?kind=nope");
    expect(badKind.status).toBe(400);
    expect(badKind.body.success).toBe(false);

    const badResolved = await getGroups("/api/failures/groups?resolved=maybe");
    expect(badResolved.status).toBe(400);

    const badOffset = await getGroups("/api/failures/groups?offset=-1");
    expect(badOffset.status).toBe(400);
  });

  test("group events endpoint returns individual occurrences", async () => {
    const now = new Date().toISOString();
    await insertRuntimeEvent({
      id: "ge-1",
      timestamp: now,
      summary: "slots saturated",
    });
    await insertRuntimeEvent({
      id: "ge-2",
      timestamp: now,
      summary: "slots saturated",
    });

    const groups = await getGroups("/api/failures/groups?limit=10");
    expect(groups.body.groups).toHaveLength(1);
    const fp = groups.body.groups![0].fingerprint;
    const encoded = encodeURIComponent(fp);

    const res = await fetch(
      `${baseUrl}/api/failures/groups/${encoded}/events?limit=50`,
    );
    const body = (await res.json()) as GroupEventsBody;
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.total).toBe(2);
    expect(body.events).toHaveLength(2);
    expect(body.events!.every((e) => e.fingerprint === fp)).toBe(true);
  });
});
