/**
 * Persistable credit status invariant (BSH-145):
 * `stale`/`expired` are read-time freshness only and must never be written.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Database } from "../../db/database.js";
import {
  toPersistedCreditStatus,
  upsertProviderCreditSnapshot,
  latestProviderCreditSnapshots,
  rowToApiCredit,
} from "../../db/queries/provider-credits.js";
import type { CreditSnapshot } from "../../services/provider-connectors/types.js";

describe("toPersistedCreditStatus", () => {
  test("passes through persistable connector statuses", () => {
    expect(toPersistedCreditStatus("ok")).toBe("ok");
    expect(toPersistedCreditStatus("limited")).toBe("limited");
    expect(toPersistedCreditStatus("unavailable")).toBe("unavailable");
    expect(toPersistedCreditStatus("error")).toBe("error");
  });

  test("maps read-time freshness back to ok for storage", () => {
    expect(toPersistedCreditStatus("stale")).toBe("ok");
    expect(toPersistedCreditStatus("expired")).toBe("ok");
  });
});

describe("upsertProviderCreditSnapshot persistable status", () => {
  let fixtureDir: string;
  let db: Database;

  beforeEach(async () => {
    fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-credits-"));
    db = new Database(path.join(fixtureDir, "test.db"));
    await db.initialize();
  });

  afterEach(async () => {
    await db.close();
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  });

  function snap(status: CreditSnapshot["status"]): CreditSnapshot {
    return {
      provider: "openai",
      asOf: "2026-07-10T12:00:00.000Z",
      remaining: 98,
      total: 100,
      unit: "percent",
      label: "quota_codex:secondary_10080m",
      source: "session_quota",
      status,
      surface: "plan_usage",
      details: {
        windowMinutes: 10080,
        resetsAt: "2026-07-17T12:00:00.000Z",
      },
    };
  }

  test("refuses to persist stale/expired (CHECK would reject them)", async () => {
    await upsertProviderCreditSnapshot(db.raw(), snap("expired"));
    await upsertProviderCreditSnapshot(db.raw(), {
      ...snap("stale"),
      asOf: "2026-07-11T12:00:00.000Z",
      label: "prepaid_balance",
      unit: "usd",
      surface: "wallet",
      source: "provider_api",
    });

    const rows = await latestProviderCreditSnapshots(db.raw());
    expect(rows.every((r) => r.status === "ok")).toBe(true);
  });

  test("raw INSERT of stale fails the schema CHECK", async () => {
    await expect(
      db.raw().run(
        `INSERT INTO provider_credit_snapshots (
           provider, as_of, remaining, total, unit, label, source, status
         ) VALUES ('openai', '2026-08-01T00:00:00.000Z', 1, 1, 'usd',
                   'prepaid_balance', 'provider_api', 'stale')`,
      ),
    ).rejects.toThrow(/CHECK/i);
  });

  test("rowToApiCredit still demotes persisted ok to expired at read", async () => {
    await upsertProviderCreditSnapshot(db.raw(), snap("expired"));
    const [row] = await latestProviderCreditSnapshots(db.raw());
    expect(row.status).toBe("ok");
    const api = rowToApiCredit(row, new Date("2026-08-05T12:00:00.000Z"));
    expect(api.status).toBe("expired");
  });
});
