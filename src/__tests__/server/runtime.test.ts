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
import {
  RUNTIME_DEFAULT_PAGE_SIZE,
  RUNTIME_SUMMARY_TARGET_MS,
  slimSnapshotPayload,
} from "../../server/routes/runtime.js";

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
  section?: string;
  sources?: Array<{ id: string; kind: string; instances: unknown[] }>;
  snapshots?: Array<{
    kind: string;
    payload: { port?: number; label?: string } | null;
    modelsLoaded?: unknown;
  }>;
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
  requestsByClient?: Array<{
    clientLabel: string;
    requestCount: number;
    promptTokens: number;
    completionTokens: number;
  }>;
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
    items: Array<{
      id: string;
      kind: string;
      summary: string;
      details?: unknown;
    }>;
    total: number;
    page: number;
    pageSize: number;
  };
};

async function getJson(pathAndQuery: string) {
  const res = await fetch(`${baseUrl}${pathAndQuery}`);
  const body = (await res.json()) as RuntimeBody;
  return {
    status: res.status,
    body,
    appMs: Number(res.headers.get("x-runtime-app-ms") ?? NaN),
    sectionHeader: res.headers.get("x-runtime-section"),
  };
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
    expect(body.requestsByClient).toEqual([]);
    expect(body.filters?.requestStatuses).toContain("success");
    expect(body.filters?.eventKinds).toContain("slots_saturated");
  });

  test("BSH-89: requestsByClient aggregates volume per client_label", async () => {
    const now = Date.now();
    for (let i = 0; i < 3; i++) {
      await insertRequest({
        id: `opencode-${i}`,
        timestamp: new Date(now - i * 1000).toISOString(),
        clientLabel: "opencode",
      });
    }
    await insertRequest({
      id: "hermes-1",
      timestamp: new Date(now - 5000).toISOString(),
      clientLabel: "hermes-qwen",
    });

    const { status, body } = await getJson("/api/runtime?range=24h");
    expect(status).toBe(200);
    expect(body.requestsByClient).toEqual([
      {
        clientLabel: "opencode",
        requestCount: 3,
        promptTokens: 0,
        completionTokens: 0,
      },
      {
        clientLabel: "hermes-qwen",
        requestCount: 1,
        promptTokens: 0,
        completionTokens: 0,
      },
    ]);
    expect(body.filters?.clientLabels).toEqual(["hermes-qwen", "opencode"]);
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

  test("filters requests and events by sourceId", async () => {
    const now = new Date().toISOString();
    await insertRequest({
      id: "hermes-req",
      timestamp: now,
      status: "success",
    });
    await insertEvent({
      id: "hermes-evt",
      timestamp: now,
    });
    await insertSlotSnapshot({ busy: 2, total: 4 });
    // lemonade source rows (seeded source/instance)
    await db.raw().run(
      `INSERT INTO inference_requests (
        id, source_id, instance_id, timestamp, model, client_label, status
      ) VALUES ('lem-req', 'lemonade', 'lemonade@strix-halo', ?, 'm', 'c', 'success')`,
      now,
    );
    await db.raw().run(
      `INSERT INTO runtime_events (
        id, source_id, instance_id, timestamp, ended_at, kind, severity, summary
      ) VALUES ('lem-evt', 'lemonade', 'lemonade@strix-halo', ?, NULL, 'service_down', 'error', 'down')`,
      now,
    );
    await db.raw().run(
      `INSERT INTO runtime_snapshots (
        source_id, instance_id, timestamp, kind, slots_total, slots_busy, payload
      ) VALUES ('lemonade', 'lemonade@strix-halo', ?, 'slots', 8, 1, ?)`,
      now,
      JSON.stringify({ port: 9000, label: "lem" }),
    );

    const { body } = await getJson("/api/runtime?range=all&sourceId=lemonade");
    expect(body.inferenceRequests?.total).toBe(1);
    expect(body.inferenceRequests?.items[0]?.id).toBe("lem-req");
    expect(body.runtimeEvents?.total).toBe(1);
    expect(body.runtimeEvents?.items[0]?.id).toBe("lem-evt");
    expect(body.metrics?.requestCount).toBe(1);
    expect(body.metrics?.totalSlots).toBe(8);
    expect(body.metrics?.activeSlots).toBe(1);
    expect(body.sources).toEqual([expect.objectContaining({ id: "lemonade" })]);
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

  // ─── BSH-102: progressive sections, slim payload, slow filter, perf ───

  test("section=summary omits lists; section=lists omits summary fields", async () => {
    const now = new Date().toISOString();
    await insertRequest({ id: "s-req", timestamp: now, durationMs: 50 });
    await insertEvent({ id: "s-evt", timestamp: now });
    await insertSlotSnapshot({ busy: 1, total: 2 });

    const summary = await getJson("/api/runtime?range=24h&section=summary");
    expect(summary.status).toBe(200);
    expect(summary.body.section).toBe("summary");
    expect(summary.sectionHeader).toBe("summary");
    expect(summary.body.metrics?.requestCount).toBe(1);
    expect(summary.body.snapshots?.length).toBeGreaterThan(0);
    expect(summary.body.filters?.clientLabels).toBeDefined();
    expect(summary.body.inferenceRequests).toBeUndefined();
    expect(summary.body.runtimeEvents).toBeUndefined();

    const lists = await getJson("/api/runtime?range=24h&section=lists");
    expect(lists.status).toBe(200);
    expect(lists.body.section).toBe("lists");
    expect(lists.body.inferenceRequests?.total).toBe(1);
    expect(lists.body.runtimeEvents?.total).toBe(1);
    expect(lists.body.metrics).toBeUndefined();
    expect(lists.body.sources).toBeUndefined();
    expect(lists.body.snapshots).toBeUndefined();
  });

  test("slims large snapshot payload to port/label only", async () => {
    const bloated = {
      port: 9090,
      label: "backend-heavy",
      gpuMemory: "8192MB",
      processes: Array.from({ length: 50 }, (_, i) => ({
        pid: i,
        cmd: `worker-${i}`,
        rss: 1024 * i,
      })),
      rawStats: { a: 1, b: 2, nested: { deep: true } },
    };
    await db.raw().run(
      `INSERT INTO runtime_snapshots (
        source_id, instance_id, timestamp, kind, slots_total, slots_busy, payload
      ) VALUES ('hermes', ?, ?, 'slots', 2, 1, ?)`,
      HERMES_INSTANCE,
      new Date().toISOString(),
      JSON.stringify(bloated),
    );

    const { body } = await getJson("/api/runtime?range=1h&section=summary");
    const slot = body.snapshots?.find((s) => s.kind === "slots");
    expect(slot?.payload).toEqual({ port: 9090, label: "backend-heavy" });
    expect(slot?.payload).not.toHaveProperty("gpuMemory");
    expect(slot?.payload).not.toHaveProperty("processes");
    expect(slot?.payload).not.toHaveProperty("rawStats");
  });

  test("slimSnapshotPayload unit: drops non-UI fields", () => {
    expect(
      slimSnapshotPayload({
        port: 1,
        label: "x",
        extra: { huge: true },
      }),
    ).toEqual({ port: 1, label: "x" });
    expect(slimSnapshotPayload(null)).toBeNull();
    expect(slimSnapshotPayload("nope")).toBeNull();
    expect(slimSnapshotPayload({})).toBeNull();
  });

  test("omits runtime event details from list payload", async () => {
    await db.raw().run(
      `INSERT INTO runtime_events (
        id, source_id, instance_id, timestamp, ended_at, kind, severity, summary, details
      ) VALUES (?, 'hermes', ?, ?, NULL, 'slots_saturated', 'warning', 'full', ?)`,
      "evt-details",
      HERMES_INSTANCE,
      new Date().toISOString(),
      JSON.stringify({ slots: [1, 2, 3], raw: "big" }),
    );
    const { body } = await getJson("/api/runtime?range=all&section=lists");
    const item = body.runtimeEvents?.items.find((e) => e.id === "evt-details");
    expect(item).toBeDefined();
    expect(item).not.toHaveProperty("details");
  });

  test("filters slow requests by reqMinDurationMs", async () => {
    const now = Date.now();
    await insertRequest({
      id: "fast",
      timestamp: new Date(now).toISOString(),
      durationMs: 100,
    });
    await insertRequest({
      id: "slow",
      timestamp: new Date(now - 1000).toISOString(),
      durationMs: 5000,
    });
    await insertRequest({
      id: "untimed",
      timestamp: new Date(now - 2000).toISOString(),
      durationMs: null,
    });

    const { body } = await getJson(
      "/api/runtime?range=all&section=lists&reqMinDurationMs=1000",
    );
    expect(body.inferenceRequests?.total).toBe(1);
    expect(body.inferenceRequests?.items[0]?.id).toBe("slow");

    const bad = await getJson("/api/runtime?reqMinDurationMs=0");
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/reqMinDurationMs/);
  });

  test("summary section meets performance target on live-sized dataset", async () => {
    // ~live-sized: 5k recent requests, 100 slot snapshots (many historical),
    // 200 events — summary must not load list pages and stay under target.
    const now = Date.now();
    const raw = db.raw();

    for (let i = 0; i < 5000; i++) {
      await raw.run(
        `INSERT INTO inference_requests (
          id, source_id, instance_id, timestamp, model, client_label, status,
          duration_ms
        ) VALUES (?, 'hermes', ?, ?, 'm', ?, ?, ?)`,
        `perf-req-${i}`,
        HERMES_INSTANCE,
        new Date(now - i * 100).toISOString(),
        i % 2 === 0 ? "opencode" : "openclaw",
        i % 7 === 0 ? "cancelled" : "success",
        50 + (i % 400),
      );
    }
    for (let i = 0; i < 200; i++) {
      await raw.run(
        `INSERT INTO runtime_events (
          id, source_id, instance_id, timestamp, ended_at, kind, severity, summary, details
        ) VALUES (?, 'hermes', ?, ?, NULL, 'slots_saturated', 'warning', ?, ?)`,
        `perf-evt-${i}`,
        HERMES_INSTANCE,
        new Date(now - i * 1000).toISOString(),
        `event ${i}`,
        JSON.stringify({ bulk: "x".repeat(200) }),
      );
    }
    // One current bloated snapshot + older noise
    for (let i = 0; i < 50; i++) {
      await raw.run(
        `INSERT INTO runtime_snapshots (
          source_id, instance_id, timestamp, kind, slots_total, slots_busy, payload
        ) VALUES ('hermes', ?, ?, 'slots', 4, 2, ?)`,
        HERMES_INSTANCE,
        new Date(now - i * 5000).toISOString(),
        JSON.stringify({
          port: 8080 + (i % 3),
          label: `backend-${i % 3}`,
          noise: "y".repeat(500),
        }),
      );
    }

    const { status, body, appMs } = await getJson(
      "/api/runtime?range=24h&section=summary",
    );
    expect(status).toBe(200);
    expect(body.metrics?.requestCount).toBe(5000);
    expect(body.inferenceRequests).toBeUndefined();
    expect(Number.isFinite(appMs)).toBe(true);
    // Documented budget: RUNTIME_SUMMARY_TARGET_MS (250ms) with modest CI slack.
    expect(appMs).toBeLessThanOrEqual(RUNTIME_SUMMARY_TARGET_MS * 1.5);
    expect(RUNTIME_SUMMARY_TARGET_MS).toBe(250);
  });
});
