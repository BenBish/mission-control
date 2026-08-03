/**
 * Runtime API — pagination, filters, and operational metrics.
 * Covers empty, partial-page, multi-page (saturated), filter, and validation states.
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
import { RUNTIME_DEFAULT_PAGE_SIZE } from "../../server/routes/runtime.js";

let fixtureDir: string;
let server: ReturnType<ReturnType<typeof express>["listen"]>;
let baseUrl: string;
let db: Database;

const HERMES_INSTANCE = "hermes@strix-halo";

beforeAll(async () => {
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-runtime-"));
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
  await raw.run("DELETE FROM inference_requests");
  await raw.run("DELETE FROM runtime_events");
  await raw.run("DELETE FROM runtime_snapshots");
});

type RuntimeBody = {
  success: boolean;
  error?: string;
  range?: string;
  sources?: Array<{ id: string; kind: string; instances: unknown[] }>;
  snapshots?: unknown[];
  metrics?: {
    activeSlots: number;
    totalSlots: number;
    saturationRate: number | null;
    requestThroughputPerHour: number | null;
    cancellationRate: number | null;
    p50LatencyMs: number | null;
    p95LatencyMs: number | null;
    requestCount: number;
    since: string | null;
    windowHours: number | null;
  };
  filters?: {
    clientLabels: string[];
    requestStatuses: string[];
    eventKinds: string[];
  };
  inferenceRequests?: {
    items: Array<{
      id: string;
      status: string;
      clientLabel: string | null;
      durationMs: number | null;
    }>;
    total: number;
    page: number;
    pageSize: number;
  };
  runtimeEvents?: {
    items: Array<{ id: string; kind: string; summary: string }>;
    total: number;
    page: number;
    pageSize: number;
  };
};

async function getJson(pathAndQuery: string) {
  const res = await fetch(`${baseUrl}${pathAndQuery}`);
  const body = (await res.json()) as RuntimeBody;
  return { status: res.status, body };
}

async function insertRequest(opts: {
  id: string;
  timestamp: string;
  status?: string;
  clientLabel?: string;
  durationMs?: number | null;
}) {
  await db.raw().run(
    `INSERT INTO inference_requests (
      id, source_id, instance_id, timestamp, model, client_label, status,
      duration_ms
    ) VALUES (?, 'hermes', ?, ?, 'test-model', ?, ?, ?)`,
    opts.id,
    HERMES_INSTANCE,
    opts.timestamp,
    opts.clientLabel ?? "openclaw",
    opts.status ?? "success",
    opts.durationMs ?? null,
  );
}

async function insertEvent(opts: {
  id: string;
  timestamp: string;
  kind?: string;
  severity?: string;
}) {
  await db.raw().run(
    `INSERT INTO runtime_events (
      id, source_id, instance_id, timestamp, ended_at, kind, severity, summary
    ) VALUES (?, 'hermes', ?, ?, NULL, ?, ?, ?)`,
    opts.id,
    HERMES_INSTANCE,
    opts.timestamp,
    opts.kind ?? "slots_saturated",
    opts.severity ?? "warning",
    `event ${opts.id}`,
  );
}

async function insertSlotSnapshot(opts: {
  busy: number;
  total: number;
  port?: number;
  timestamp?: string;
}) {
  await db.raw().run(
    `INSERT INTO runtime_snapshots (
      source_id, instance_id, timestamp, kind, slots_total, slots_busy, payload
    ) VALUES ('hermes', ?, ?, 'slots', ?, ?, ?)`,
    HERMES_INSTANCE,
    opts.timestamp ?? new Date().toISOString(),
    opts.total,
    opts.busy,
    JSON.stringify({ port: opts.port ?? 8080, label: "backend-a" }),
  );
}

describe("GET /api/runtime", () => {
  test("empty dataset: zero metrics, empty paginated lists, default page size", async () => {
    const { status, body } = await getJson("/api/runtime?range=24h");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.range).toBe("24h");
    expect(body.inferenceRequests?.items).toEqual([]);
    expect(body.inferenceRequests?.total).toBe(0);
    expect(body.inferenceRequests?.page).toBe(1);
    expect(body.inferenceRequests?.pageSize).toBe(RUNTIME_DEFAULT_PAGE_SIZE);
    expect(body.runtimeEvents?.items).toEqual([]);
    expect(body.runtimeEvents?.total).toBe(0);
    expect(body.metrics?.activeSlots).toBe(0);
    expect(body.metrics?.totalSlots).toBe(0);
    expect(body.metrics?.saturationRate).toBeNull();
    expect(body.metrics?.cancellationRate).toBeNull();
    expect(body.metrics?.p50LatencyMs).toBeNull();
    expect(body.metrics?.p95LatencyMs).toBeNull();
    expect(body.metrics?.requestCount).toBe(0);
    expect(body.filters?.requestStatuses).toContain("success");
    expect(body.filters?.eventKinds).toContain("slots_saturated");
  });

  test("paginates requests with total across pages (saturated list)", async () => {
    const now = Date.now();
    // Insert more than one page worth of recent requests
    for (let i = 0; i < RUNTIME_DEFAULT_PAGE_SIZE + 5; i++) {
      await insertRequest({
        id: `req-${i}`,
        timestamp: new Date(now - i * 1000).toISOString(),
        status: i % 3 === 0 ? "cancelled" : "success",
        durationMs: 100 + i * 10,
      });
    }

    const page1 = await getJson(
      `/api/runtime?range=24h&reqLimit=${RUNTIME_DEFAULT_PAGE_SIZE}&reqPage=1`,
    );
    expect(page1.status).toBe(200);
    expect(page1.body.inferenceRequests?.total).toBe(
      RUNTIME_DEFAULT_PAGE_SIZE + 5,
    );
    expect(page1.body.inferenceRequests?.items).toHaveLength(
      RUNTIME_DEFAULT_PAGE_SIZE,
    );
    expect(page1.body.inferenceRequests?.page).toBe(1);
    expect(page1.body.inferenceRequests?.pageSize).toBe(
      RUNTIME_DEFAULT_PAGE_SIZE,
    );

    const page2 = await getJson(
      `/api/runtime?range=24h&reqLimit=${RUNTIME_DEFAULT_PAGE_SIZE}&reqPage=2`,
    );
    expect(page2.body.inferenceRequests?.items).toHaveLength(5);
    expect(page2.body.inferenceRequests?.page).toBe(2);
    expect(page2.body.inferenceRequests?.total).toBe(
      RUNTIME_DEFAULT_PAGE_SIZE + 5,
    );

    // Pages should not overlap
    const ids1 = new Set(
      page1.body.inferenceRequests?.items.map((r) => r.id) ?? [],
    );
    for (const r of page2.body.inferenceRequests?.items ?? []) {
      expect(ids1.has(r.id)).toBe(false);
    }
  });

  test("paginates runtime events independently of requests", async () => {
    const now = Date.now();
    for (let i = 0; i < 7; i++) {
      await insertEvent({
        id: `evt-${i}`,
        timestamp: new Date(now - i * 1000).toISOString(),
        kind: i % 2 === 0 ? "slots_saturated" : "service_down",
      });
    }

    const { body } = await getJson(
      "/api/runtime?range=24h&eventLimit=3&eventPage=1",
    );
    expect(body.runtimeEvents?.total).toBe(7);
    expect(body.runtimeEvents?.items).toHaveLength(3);
    expect(body.runtimeEvents?.pageSize).toBe(3);

    const page2 = await getJson(
      "/api/runtime?range=24h&eventLimit=3&eventPage=2",
    );
    expect(page2.body.runtimeEvents?.items).toHaveLength(3);
    expect(page2.body.runtimeEvents?.page).toBe(2);
  });

  test("filters requests by status and client", async () => {
    const now = new Date().toISOString();
    await insertRequest({
      id: "r-ok",
      timestamp: now,
      status: "success",
      clientLabel: "openclaw",
    });
    await insertRequest({
      id: "r-err",
      timestamp: now,
      status: "error",
      clientLabel: "openclaw",
    });
    await insertRequest({
      id: "r-cancel",
      timestamp: now,
      status: "cancelled",
      clientLabel: "cron",
    });

    const byStatus = await getJson("/api/runtime?range=all&reqStatus=error");
    expect(byStatus.body.inferenceRequests?.total).toBe(1);
    expect(byStatus.body.inferenceRequests?.items[0]?.id).toBe("r-err");

    const byClient = await getJson("/api/runtime?range=all&reqClient=cron");
    expect(byClient.body.inferenceRequests?.total).toBe(1);
    expect(byClient.body.inferenceRequests?.items[0]?.id).toBe("r-cancel");
    expect(byClient.body.filters?.clientLabels).toEqual(
      expect.arrayContaining(["cron", "openclaw"]),
    );
  });

  test("filters events by kind", async () => {
    const now = new Date().toISOString();
    await insertEvent({
      id: "e-sat",
      timestamp: now,
      kind: "slots_saturated",
    });
    await insertEvent({
      id: "e-down",
      timestamp: now,
      kind: "service_down",
    });

    const { body } = await getJson(
      "/api/runtime?range=all&eventKind=service_down",
    );
    expect(body.runtimeEvents?.total).toBe(1);
    expect(body.runtimeEvents?.items[0]?.id).toBe("e-down");
  });

  test("time range excludes old rows from lists and metrics", async () => {
    const recent = new Date().toISOString();
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    await insertRequest({
      id: "recent",
      timestamp: recent,
      status: "success",
      durationMs: 200,
    });
    await insertRequest({
      id: "old",
      timestamp: old,
      status: "cancelled",
      durationMs: 500,
    });
    await insertEvent({ id: "e-recent", timestamp: recent });
    await insertEvent({ id: "e-old", timestamp: old });

    const { body } = await getJson("/api/runtime?range=24h");
    expect(body.inferenceRequests?.total).toBe(1);
    expect(body.inferenceRequests?.items[0]?.id).toBe("recent");
    expect(body.runtimeEvents?.total).toBe(1);
    expect(body.metrics?.requestCount).toBe(1);
    expect(body.metrics?.cancellationRate).toBe(0);
    expect(body.metrics?.windowHours).toBe(24);
  });

  test("metrics: active slots, saturation, cancellation rate, p50/p95", async () => {
    await insertSlotSnapshot({ busy: 2, total: 2, port: 8080 });
    await insertSlotSnapshot({ busy: 1, total: 4, port: 8081 });

    const base = Date.now();
    // 4 requests: 1 cancelled, durations 100,200,300,400 → p50=250, p95≈385
    const durations = [100, 200, 300, 400];
    for (let i = 0; i < durations.length; i++) {
      await insertRequest({
        id: `m-${i}`,
        timestamp: new Date(base - i * 1000).toISOString(),
        status: i === 0 ? "cancelled" : "success",
        durationMs: durations[i],
      });
    }

    const { body } = await getJson("/api/runtime?range=1h");
    expect(body.metrics?.activeSlots).toBe(3);
    expect(body.metrics?.totalSlots).toBe(6);
    expect(body.metrics?.saturationRate).toBeCloseTo(0.5, 5);
    expect(body.metrics?.cancellationRate).toBeCloseTo(0.25, 5);
    expect(body.metrics?.requestCount).toBe(4);
    expect(body.metrics?.p50LatencyMs).toBeCloseTo(250, 0);
    expect(body.metrics?.p95LatencyMs).toBeCloseTo(385, 0);
    expect(body.metrics?.requestThroughputPerHour).not.toBeNull();
    expect(body.metrics?.requestThroughputPerHour!).toBeGreaterThan(0);
  });

  test("saturated slots surface as 100% saturation rate", async () => {
    await insertSlotSnapshot({ busy: 4, total: 4 });
    const { body } = await getJson("/api/runtime?range=1h");
    expect(body.metrics?.activeSlots).toBe(4);
    expect(body.metrics?.totalSlots).toBe(4);
    expect(body.metrics?.saturationRate).toBe(1);
  });

  test("rejects invalid status, event kind, and non-positive page params", async () => {
    const badStatus = await getJson("/api/runtime?reqStatus=nope");
    expect(badStatus.status).toBe(400);
    expect(badStatus.body.success).toBe(false);
    expect(badStatus.body.error).toMatch(/reqStatus/);

    const badKind = await getJson("/api/runtime?eventKind=nope");
    expect(badKind.status).toBe(400);
    expect(badKind.body.error).toMatch(/eventKind/);

    const badPage = await getJson("/api/runtime?reqPage=0");
    expect(badPage.status).toBe(400);
    expect(badPage.body.error).toMatch(/reqPage/);

    const badLimit = await getJson("/api/runtime?reqLimit=notanumber");
    expect(badLimit.status).toBe(400);
    expect(badLimit.body.error).toMatch(/reqLimit/);
  });

  test("legacy limit param still bounds both lists", async () => {
    const now = Date.now();
    for (let i = 0; i < 10; i++) {
      await insertRequest({
        id: `leg-${i}`,
        timestamp: new Date(now - i * 1000).toISOString(),
      });
      await insertEvent({
        id: `lege-${i}`,
        timestamp: new Date(now - i * 1000).toISOString(),
      });
    }
    const { body } = await getJson("/api/runtime?range=all&limit=3");
    expect(body.inferenceRequests?.pageSize).toBe(3);
    expect(body.inferenceRequests?.items).toHaveLength(3);
    expect(body.runtimeEvents?.pageSize).toBe(3);
    expect(body.runtimeEvents?.items).toHaveLength(3);
    expect(body.inferenceRequests?.total).toBe(10);
  });
});
