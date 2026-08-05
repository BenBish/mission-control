/**
 * Provider usage `since` day-key filtering (BSH-97).
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Database } from "../../db/database.js";
import {
  getProviderUsage,
  getProviderUsageBreakdown,
  upsertProviderUsage,
} from "../../db/queries/provider-usage.js";

let fixtureDir: string;
let db: Database;

beforeAll(async () => {
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-prov-since-"));
  db = new Database(path.join(fixtureDir, "test.db"));
  await db.initialize();

  for (const day of ["2026-08-03", "2026-08-04", "2026-08-05"]) {
    await upsertProviderUsage(db.raw(), {
      provider: "openrouter",
      day,
      model: "test/model",
      inputTokens: 100,
      outputTokens: 10,
      costUsd: 0.01,
      requestCount: 1,
    });
  }
});

afterAll(async () => {
  await db.close().catch(() => {});
  if (fixtureDir) fs.rmSync(fixtureDir, { recursive: true, force: true });
});

describe("getProviderUsage since day keys", () => {
  test("YYYY-MM-DD includes that day and later", async () => {
    const rows = await getProviderUsage(db.raw(), { since: "2026-08-05" });
    expect(rows.map((r) => r.day).sort()).toEqual(["2026-08-05"]);
  });

  test("YYYY-MM-DD mid-range includes two days", async () => {
    const rows = await getProviderUsage(db.raw(), { since: "2026-08-04" });
    expect(rows.map((r) => r.day).sort()).toEqual(["2026-08-04", "2026-08-05"]);
  });

  test("ISO datetime uses UTC day of the instant", async () => {
    // Prior-day local-midnight style ISO must not pull in extra days beyond its UTC day.
    const rows = await getProviderUsage(db.raw(), {
      since: "2026-08-04T23:00:00.000Z",
    });
    expect(rows.map((r) => r.day).sort()).toEqual(["2026-08-04", "2026-08-05"]);
  });
});

describe("getProviderUsageBreakdown since day keys", () => {
  test("today-style day key aggregates only that day", async () => {
    const rows = await getProviderUsageBreakdown(db.raw(), {
      since: "2026-08-05",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].input_tokens).toBe(100);
    expect(rows[0].cost_usd).toBeCloseTo(0.01);
  });

  test("pure day key is preferred client form for calendar presets", async () => {
    const fromDay = await getProviderUsageBreakdown(db.raw(), {
      since: "2026-08-05",
    });
    const fromUtcMidnight = await getProviderUsageBreakdown(db.raw(), {
      since: "2026-08-05T00:00:00.000Z",
    });
    expect(fromDay[0].input_tokens).toBe(fromUtcMidnight[0].input_tokens);
  });
});
