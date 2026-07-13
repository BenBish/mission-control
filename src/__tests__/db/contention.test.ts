/**
 * Contention-incident overlap math, against a real seeded database — the
 * interval-overlap logic in src/db/queries/contention.ts is exactly the
 * kind of off-by-one-prone code worth testing directly rather than trusting
 * by inspection.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Database } from "../../db/database.js";
import { listContentionIncidents } from "../../db/queries/contention.js";

let fixtureDir: string;
let db: Database;

const INSTANCE = "hermes@strix-halo";

beforeAll(async () => {
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-contention-"));
  db = new Database(path.join(fixtureDir, "test.db"));
  await db.initialize();
});

afterAll(async () => {
  await db.close();
  fs.rmSync(fixtureDir, { recursive: true, force: true });
});

async function seedRequest(opts: {
  id: string;
  timestamp: string;
  durationMs: number;
  workload: "foreground" | "background" | "unknown";
}) {
  await db.raw().run(
    `INSERT INTO inference_requests (id, source_id, instance_id, timestamp, duration_ms, workload, status)
     VALUES (?, 'hermes', ?, ?, ?, ?, 'success')`,
    opts.id,
    INSTANCE,
    opts.timestamp,
    opts.durationMs,
    opts.workload,
  );
}

async function seedSaturation(opts: {
  id: string;
  timestamp: string;
  endedAt: string;
}) {
  await db.raw().run(
    `INSERT INTO runtime_events (id, source_id, instance_id, timestamp, ended_at, kind, severity, summary)
     VALUES (?, 'hermes', ?, ?, ?, 'slots_saturated', 'warning', 'test saturation')`,
    opts.id,
    INSTANCE,
    opts.timestamp,
    opts.endedAt,
  );
}

describe("listContentionIncidents", () => {
  test("finds an incident when background, saturation, and foreground windows all overlap", async () => {
    await seedRequest({
      id: "bg-1",
      timestamp: "2026-06-01T00:00:00.000Z",
      durationMs: 10_000, // ends 00:00:10
      workload: "background",
    });
    await seedSaturation({
      id: "sat-1",
      timestamp: "2026-06-01T00:00:02.000Z",
      endedAt: "2026-06-01T00:00:08.000Z",
    });
    await seedRequest({
      id: "fg-1",
      timestamp: "2026-06-01T00:00:03.000Z",
      durationMs: 4_000, // ends 00:00:07 — inside both the bg and sat windows
      workload: "foreground",
    });

    const incidents = await listContentionIncidents(db.raw(), {
      since: "2026-01-01T00:00:00.000Z",
    });

    const found = incidents.find(
      (i) =>
        i.backgroundRequestId === "bg-1" && i.foregroundRequestId === "fg-1",
    );
    expect(found).toBeDefined();
    expect(found?.saturationEventId).toBe("sat-1");
  });

  test("does not report an incident when the background request never overlaps a saturation window", async () => {
    await seedRequest({
      id: "bg-2",
      timestamp: "2026-06-02T00:00:00.000Z",
      durationMs: 1_000, // ends 00:00:01
      workload: "background",
    });
    await seedSaturation({
      id: "sat-2",
      timestamp: "2026-06-02T00:01:00.000Z", // starts a full minute later — no overlap
      endedAt: "2026-06-02T00:01:10.000Z",
    });
    await seedRequest({
      id: "fg-2",
      timestamp: "2026-06-02T00:01:02.000Z",
      durationMs: 1_000,
      workload: "foreground",
    });

    const incidents = await listContentionIncidents(db.raw(), {
      since: "2026-01-01T00:00:00.000Z",
    });
    expect(
      incidents.find((i) => i.backgroundRequestId === "bg-2"),
    ).toBeUndefined();
  });

  test("does not report an incident when saturation and background overlap but no foreground request does", async () => {
    await seedRequest({
      id: "bg-3",
      timestamp: "2026-06-03T00:00:00.000Z",
      durationMs: 10_000,
      workload: "background",
    });
    await seedSaturation({
      id: "sat-3",
      timestamp: "2026-06-03T00:00:02.000Z",
      endedAt: "2026-06-03T00:00:08.000Z",
    });
    // No foreground request seeded in this window at all.

    const incidents = await listContentionIncidents(db.raw(), {
      since: "2026-01-01T00:00:00.000Z",
    });
    expect(
      incidents.find((i) => i.backgroundRequestId === "bg-3"),
    ).toBeUndefined();
  });

  test("adjacent (touching, not overlapping) windows don't count as an incident", async () => {
    await seedRequest({
      id: "bg-4",
      timestamp: "2026-06-04T00:00:00.000Z",
      durationMs: 5_000, // ends exactly at 00:00:05
      workload: "background",
    });
    await seedSaturation({
      id: "sat-4",
      timestamp: "2026-06-04T00:00:05.000Z", // starts exactly when bg-4 ends
      endedAt: "2026-06-04T00:00:10.000Z",
    });
    await seedRequest({
      id: "fg-4",
      timestamp: "2026-06-04T00:00:05.000Z",
      durationMs: 2_000,
      workload: "foreground",
    });

    const incidents = await listContentionIncidents(db.raw(), {
      since: "2026-01-01T00:00:00.000Z",
    });
    expect(
      incidents.find((i) => i.backgroundRequestId === "bg-4"),
    ).toBeUndefined();
  });
});
