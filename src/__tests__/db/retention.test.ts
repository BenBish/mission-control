/**
 * runtime_snapshots retention/rollup, against a real seeded database —
 * the hour-bucketing and aggregate math in
 * src/db/queries/retention.ts is worth verifying directly, not just by
 * inspection.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Database } from "../../db/database.js";
import { runRuntimeSnapshotRetention } from "../../db/queries/retention.js";

let fixtureDir: string;
let db: Database;

const INSTANCE = "hermes@strix-halo";

beforeEach(async () => {
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-retention-"));
  db = new Database(path.join(fixtureDir, "test.db"));
  await db.initialize();
});

afterEach(async () => {
  await db.close();
  fs.rmSync(fixtureDir, { recursive: true, force: true });
});

async function seedSlotSnapshot(opts: {
  timestamp: string;
  port: number;
  slotsTotal: number;
  slotsBusy: number;
}) {
  await db.raw().run(
    `INSERT INTO runtime_snapshots (source_id, instance_id, timestamp, kind, slots_total, slots_busy, payload)
     VALUES ('hermes', ?, ?, 'slots', ?, ?, ?)`,
    INSTANCE,
    opts.timestamp,
    opts.slotsTotal,
    opts.slotsBusy,
    JSON.stringify({ port: opts.port, label: "hermes-qwen" }),
  );
}

async function seedHealthSnapshot(timestamp: string, healthy: boolean) {
  await db.raw().run(
    `INSERT INTO runtime_snapshots (source_id, instance_id, timestamp, kind, healthy)
     VALUES ('hermes', ?, ?, 'health', ?)`,
    INSTANCE,
    timestamp,
    healthy ? 1 : 0,
  );
}

const daysAgo = (n: number) =>
  new Date(Date.now() - n * 24 * 3600_000).toISOString();

describe("runRuntimeSnapshotRetention", () => {
  test("rolls up old 'slots' rows into an hourly bucket and deletes the raw rows", async () => {
    // Three samples in the same hour, 10 days ago — well past the 7-day cutoff.
    const base = new Date(Date.now() - 10 * 24 * 3600_000);
    base.setUTCMinutes(0, 0, 0);
    const t1 = new Date(base.getTime() + 5_000).toISOString();
    const t2 = new Date(base.getTime() + 10_000).toISOString();
    const t3 = new Date(base.getTime() + 15_000).toISOString();

    await seedSlotSnapshot({
      timestamp: t1,
      port: 12346,
      slotsTotal: 2,
      slotsBusy: 0,
    });
    await seedSlotSnapshot({
      timestamp: t2,
      port: 12346,
      slotsTotal: 2,
      slotsBusy: 1,
    });
    await seedSlotSnapshot({
      timestamp: t3,
      port: 12346,
      slotsTotal: 2,
      slotsBusy: 2,
    });

    const result = await runRuntimeSnapshotRetention(db.raw());
    expect(result.slotRowsRolledUp).toBe(3);

    const raw = await db
      .raw()
      .all(`SELECT * FROM runtime_snapshots WHERE kind = 'slots'`);
    expect(raw).toHaveLength(0);

    const rollups = await db.raw().all<
      {
        sample_count: number;
        slots_busy_avg: number;
        slots_busy_max: number;
      }[]
    >(`SELECT * FROM runtime_slot_rollups WHERE instance_id = ? AND port = 12346`, INSTANCE);
    expect(rollups).toHaveLength(1);
    expect(rollups[0].sample_count).toBe(3);
    expect(rollups[0].slots_busy_avg).toBeCloseTo(1, 5); // (0+1+2)/3
    expect(rollups[0].slots_busy_max).toBe(2);
  });

  test("leaves recent 'slots' rows (within the retention window) untouched", async () => {
    await seedSlotSnapshot({
      timestamp: new Date().toISOString(),
      port: 12347,
      slotsTotal: 1,
      slotsBusy: 1,
    });

    const result = await runRuntimeSnapshotRetention(db.raw());
    expect(result.slotRowsRolledUp).toBe(0);

    const raw = await db
      .raw()
      .all(`SELECT * FROM runtime_snapshots WHERE kind = 'slots'`);
    expect(raw).toHaveLength(1);
  });

  test("deletes old non-'slots' rows without rolling them up", async () => {
    await seedHealthSnapshot(daysAgo(10), true);
    await seedHealthSnapshot(new Date().toISOString(), true); // recent — should survive

    const result = await runRuntimeSnapshotRetention(db.raw());
    expect(result.otherRowsDeleted).toBe(1);

    const raw = await db
      .raw()
      .all(`SELECT * FROM runtime_snapshots WHERE kind = 'health'`);
    expect(raw).toHaveLength(1);

    const rollups = await db.raw().all(`SELECT * FROM runtime_slot_rollups`);
    expect(rollups).toHaveLength(0); // health snapshots never produce rollup rows
  });

  test("re-running retention against an already-rolled-up bucket overwrites cleanly, not duplicates", async () => {
    const base = new Date(Date.now() - 10 * 24 * 3600_000);
    base.setUTCMinutes(0, 0, 0);
    await seedSlotSnapshot({
      timestamp: new Date(base.getTime() + 1_000).toISOString(),
      port: 12345,
      slotsTotal: 1,
      slotsBusy: 0,
    });
    await runRuntimeSnapshotRetention(db.raw());

    // More data lands in the same (already-rolled-up) hour bucket before the
    // next run — a real scenario if retention runs more often than hourly,
    // or a backfill/replay lands old data.
    await seedSlotSnapshot({
      timestamp: new Date(base.getTime() + 2_000).toISOString(),
      port: 12345,
      slotsTotal: 1,
      slotsBusy: 1,
    });
    await runRuntimeSnapshotRetention(db.raw());

    const rollups = await db
      .raw()
      .all<
        { sample_count: number; slots_busy_avg: number }[]
      >(`SELECT * FROM runtime_slot_rollups WHERE instance_id = ? AND port = 12345`, INSTANCE);
    expect(rollups).toHaveLength(1); // one row per bucket, not two
    // Weighted merge across both passes (1 sample @ busy=0, then 1 more @
    // busy=1) — not overwritten down to just the second pass's 1 sample.
    expect(rollups[0].sample_count).toBe(2);
    expect(rollups[0].slots_busy_avg).toBeCloseTo(0.5, 5);
  });
});
