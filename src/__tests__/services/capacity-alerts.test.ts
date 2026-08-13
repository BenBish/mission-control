/**
 * BSH-141: quota / wallet capacity threshold alerts.
 * Mirrors spend-alert test style: pure evaluate + persist + freshness gating.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Database } from "../../db/database.js";
import { upsertProviderCreditSnapshot } from "../../db/queries/provider-credits.js";
import { listSpendAlerts } from "../../db/queries/spend-alerts.js";
import { defaultCapacityAlertConfig } from "../../db/queries/app-settings.js";
import {
  displayCapacityWindowName,
  evaluateCapacityAlerts,
  persistCapacityAlerts,
  type CapacityCreditInput,
} from "../../services/capacity-alerts.js";

const THRESHOLDS = defaultCapacityAlertConfig();
const MONTH = "2026-08";

function credit(
  partial: Partial<CapacityCreditInput> &
    Pick<CapacityCreditInput, "provider" | "label" | "surface">,
): CapacityCreditInput {
  return {
    remaining: 50,
    unit: partial.surface === "plan_usage" ? "percent" : "usd",
    status: "ok",
    asOf: "2026-08-13T12:00:00.000Z",
    details: {},
    ...partial,
  };
}

describe("displayCapacityWindowName", () => {
  test("humanizes Claude 5h window", () => {
    expect(
      displayCapacityWindowName("quota_claude:5h_300m", {
        limitId: "claude:5h",
        windowMinutes: 300,
      }),
    ).toMatch(/Claude/i);
  });

  test("humanizes Codex secondary 7-day", () => {
    expect(
      displayCapacityWindowName("quota_codex:secondary_10080m", {
        limitId: "codex:secondary",
        windowMinutes: 10080,
      }),
    ).toMatch(/Codex/i);
  });
});

describe("evaluateCapacityAlerts", () => {
  test("fires quota alert when remaining % is at or below warn", () => {
    const alerts = evaluateCapacityAlerts({
      credits: [
        credit({
          provider: "anthropic",
          label: "quota_claude:5h_300m",
          surface: "plan_usage",
          remaining: 12,
          details: {
            limitId: "claude:5h",
            windowMinutes: 300,
            resetsAt: "2026-08-13T17:00:00.000Z",
          },
        }),
      ],
      thresholds: THRESHOLDS,
      monthKey: MONTH,
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].dataClass).toBe("quota");
    expect(alerts[0].scopeType).toBe("quota");
    expect(alerts[0].severity).toBe("warn");
    expect(alerts[0].kind).toBe("threshold");
    expect(alerts[0].message).toMatch(/plan-usage window/i);
    expect(alerts[0].message).toMatch(/not Direct API Spend/i);
    expect(alerts[0].message.toLowerCase()).not.toMatch(/spent \$/);
    expect(alerts[0].fingerprint).toMatch(/^quota_threshold:/);
  });

  test("fires critical quota alert when remaining % is at or below critical", () => {
    const alerts = evaluateCapacityAlerts({
      credits: [
        credit({
          provider: "openai",
          label: "quota_codex:primary_300m",
          surface: "plan_usage",
          remaining: 3,
          details: { limitId: "codex:primary", windowMinutes: 300 },
        }),
      ],
      thresholds: THRESHOLDS,
      monthKey: MONTH,
    });
    expect(alerts[0]?.severity).toBe("critical");
    expect(alerts[0]?.dataClass).toBe("quota");
  });

  test("does not fire quota alert when remaining % is above warn", () => {
    const alerts = evaluateCapacityAlerts({
      credits: [
        credit({
          provider: "openai",
          label: "quota_codex:primary_300m",
          surface: "plan_usage",
          remaining: 80,
        }),
      ],
      thresholds: THRESHOLDS,
      monthKey: MONTH,
    });
    expect(alerts).toHaveLength(0);
  });

  test("fires wallet alert when remaining USD is at or below warn", () => {
    const alerts = evaluateCapacityAlerts({
      credits: [
        credit({
          provider: "openrouter",
          label: "prepaid_balance",
          surface: "wallet",
          remaining: 4.2,
        }),
      ],
      thresholds: THRESHOLDS,
      monthKey: MONTH,
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].dataClass).toBe("wallet");
    expect(alerts[0].scopeType).toBe("wallet");
    expect(alerts[0].severity).toBe("warn");
    expect(alerts[0].message).toMatch(/prepaid wallet/i);
    expect(alerts[0].message).toMatch(/not Direct API Spend/i);
    expect(alerts[0].fingerprint).toMatch(/^wallet_threshold:/);
  });

  test("fires critical wallet alert at or below critical USD", () => {
    const alerts = evaluateCapacityAlerts({
      credits: [
        credit({
          provider: "openrouter",
          label: "prepaid_balance",
          surface: "wallet",
          remaining: 1.5,
        }),
      ],
      thresholds: THRESHOLDS,
      monthKey: MONTH,
    });
    expect(alerts[0]?.severity).toBe("critical");
    expect(alerts[0]?.dataClass).toBe("wallet");
  });

  test("never fires on stale, expired, or non-ok snapshots", () => {
    const alerts = evaluateCapacityAlerts({
      credits: [
        credit({
          provider: "anthropic",
          label: "quota_claude:5h_300m",
          surface: "plan_usage",
          remaining: 2,
          status: "expired",
        }),
        credit({
          provider: "openai",
          label: "quota_codex:secondary_10080m",
          surface: "plan_usage",
          remaining: 1,
          status: "stale",
        }),
        credit({
          provider: "openrouter",
          label: "prepaid_balance",
          surface: "wallet",
          remaining: 0.5,
          status: "unavailable",
        }),
      ],
      thresholds: THRESHOLDS,
      monthKey: MONTH,
    });
    expect(alerts).toHaveLength(0);
  });

  test("never fires when remaining is null", () => {
    const alerts = evaluateCapacityAlerts({
      credits: [
        credit({
          provider: "openrouter",
          label: "prepaid_balance",
          surface: "wallet",
          remaining: null,
        }),
      ],
      thresholds: THRESHOLDS,
      monthKey: MONTH,
    });
    expect(alerts).toHaveLength(0);
  });

  test("0 threshold disables that class", () => {
    const alerts = evaluateCapacityAlerts({
      credits: [
        credit({
          provider: "anthropic",
          label: "quota_claude:5h_300m",
          surface: "plan_usage",
          remaining: 1,
        }),
        credit({
          provider: "openrouter",
          label: "prepaid_balance",
          surface: "wallet",
          remaining: 0.1,
        }),
      ],
      thresholds: {
        planUsageWarnRemainingPct: 0,
        planUsageCriticalRemainingPct: 0,
        walletWarnRemainingUsd: 0,
        walletCriticalRemainingUsd: 0,
      },
      monthKey: MONTH,
    });
    expect(alerts).toHaveLength(0);
  });
});

describe("persistCapacityAlerts", () => {
  let fixtureDir: string;
  let db: Database;

  beforeAll(async () => {
    fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-cap-alerts-"));
    db = new Database(path.join(fixtureDir, "test.db"));
    await db.initialize();
  });

  afterAll(async () => {
    await db.close();
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  });

  test("persists quota row from a fresh low window and skips expired", async () => {
    const now = new Date("2026-08-13T12:00:00.000Z");
    await upsertProviderCreditSnapshot(db.raw(), {
      provider: "anthropic",
      asOf: now.toISOString(),
      remaining: 8,
      total: 100,
      unit: "percent",
      label: "quota_claude:5h_300m",
      source: "session_quota",
      status: "ok",
      surface: "plan_usage",
      details: {
        limitId: "claude:5h",
        windowMinutes: 300,
        resetsAt: "2026-08-13T17:00:00.000Z",
      },
    });
    await upsertProviderCreditSnapshot(db.raw(), {
      provider: "openai",
      asOf: "2026-07-10T12:00:00.000Z",
      remaining: 2,
      total: 100,
      unit: "percent",
      label: "quota_codex:secondary_10080m",
      source: "session_quota",
      status: "ok",
      surface: "plan_usage",
      details: {
        limitId: "codex:secondary",
        windowMinutes: 10080,
        resetsAt: "2026-07-17T12:00:00.000Z",
      },
    });

    await persistCapacityAlerts(db.raw(), { now, monthKey: MONTH });
    const quota = await listSpendAlerts(db.raw(), {
      monthKey: MONTH,
      dataClass: "quota",
    });
    expect(quota.length).toBeGreaterThanOrEqual(1);
    expect(quota.every((a) => a.dataClass === "quota")).toBe(true);
    expect(quota.some((a) => a.scopeKey?.includes("claude:5h"))).toBe(true);
    expect(quota.some((a) => a.message.includes("not Direct API Spend"))).toBe(
      true,
    );
    expect(quota.some((a) => a.scopeKey?.includes("secondary"))).toBe(false);

    const again = await persistCapacityAlerts(db.raw(), {
      now,
      monthKey: MONTH,
    });
    const quotaAfter = again.filter((a) => a.dataClass === "quota");
    expect(quotaAfter).toHaveLength(quota.length);
  });

  test("persists wallet row from a fresh low balance", async () => {
    const now = new Date("2026-08-13T12:00:00.000Z");
    await upsertProviderCreditSnapshot(db.raw(), {
      provider: "openrouter",
      asOf: now.toISOString(),
      remaining: 3.25,
      total: 100,
      unit: "usd",
      label: "prepaid_balance",
      source: "provider_api",
      status: "ok",
      surface: "wallet",
      details: {},
    });

    await persistCapacityAlerts(db.raw(), { now, monthKey: MONTH });
    const wallet = await listSpendAlerts(db.raw(), {
      monthKey: MONTH,
      dataClass: "wallet",
    });
    expect(wallet.length).toBeGreaterThanOrEqual(1);
    expect(wallet[0].dataClass).toBe("wallet");
    expect(wallet[0].message).toMatch(/prepaid wallet/i);
    expect(wallet[0].estimatedImpactUsd).toBeNull();
  });

  test("concurrent persist does not duplicate the same fingerprint", async () => {
    const now = new Date("2026-08-13T12:00:00.000Z");
    await upsertProviderCreditSnapshot(db.raw(), {
      provider: "openai",
      asOf: now.toISOString(),
      remaining: 4,
      total: 100,
      unit: "percent",
      label: "quota_codex:primary_300m",
      source: "session_quota",
      status: "ok",
      surface: "plan_usage",
      details: {
        limitId: "codex:primary",
        windowMinutes: 300,
        resetsAt: "2026-08-13T17:00:00.000Z",
      },
    });

    await Promise.all([
      persistCapacityAlerts(db.raw(), { now, monthKey: MONTH }),
      persistCapacityAlerts(db.raw(), { now, monthKey: MONTH }),
    ]);
    const quota = await listSpendAlerts(db.raw(), {
      monthKey: MONTH,
      dataClass: "quota",
    });
    const matches = quota.filter((a) =>
      a.scopeKey?.includes("codex:primary_300m"),
    );
    expect(matches).toHaveLength(1);
  });
});
