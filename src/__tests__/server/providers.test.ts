/**
 * Provider routes integration tests — status, sync, usage breakdown.
 * Uses mocked connector HTTP via env + inject only through sync path.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import express from "express";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Database } from "../../db/database.js";
import { setupRoutes } from "../../server/routes/index.js";
import { upsertProviderCreditSnapshot } from "../../db/queries/provider-credits.js";
import { upsertProviderUsage } from "../../db/queries/provider-usage.js";

let fixtureDir: string;
let server: ReturnType<ReturnType<typeof express>["listen"]>;
let baseUrl: string;
let db: Database;

beforeAll(async () => {
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-prov-routes-"));
  db = new Database(path.join(fixtureDir, "test.db"));
  await db.initialize();

  // Seed a known API-sourced row for breakdown reads
  await upsertProviderUsage(db.raw(), {
    provider: "openrouter",
    day: "2026-07-10",
    model: "test/model",
    inputTokens: 42,
    outputTokens: 7,
    costUsd: 0.003,
    requestCount: 1,
  });

  await upsertProviderCreditSnapshot(db.raw(), {
    provider: "anthropic",
    asOf: "2026-07-10T12:00:00.000Z",
    remaining: null,
    total: null,
    unit: "usd",
    label: "prepaid_balance",
    source: "unavailable",
    status: "unavailable",
    surface: "wallet",
    details: { note: "no balance API" },
  });
  // Fresh plan-usage window (must stay ok under BSH-96 freshness rules)
  await upsertProviderCreditSnapshot(db.raw(), {
    provider: "openai",
    asOf: new Date().toISOString(),
    remaining: 80,
    total: 100,
    unit: "percent",
    label: "quota_codex:primary_300m",
    source: "session_quota",
    status: "ok",
    surface: "plan_usage",
    details: {
      productLanguage: "Codex window",
      windowMinutes: 300,
      resetsAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    },
  });
  // Obsolete 7-day secondary window — must surface as expired, never green ok
  await upsertProviderCreditSnapshot(db.raw(), {
    provider: "openai",
    asOf: "2026-07-10T12:00:00.000Z",
    remaining: 98,
    total: 100,
    unit: "percent",
    label: "quota_codex:secondary_10080m",
    source: "session_quota",
    status: "ok",
    surface: "plan_usage",
    details: {
      productLanguage: "Codex secondary window",
      windowMinutes: 10080,
      resetsAt: "2026-07-17T12:00:00.000Z",
    },
  });
  // Fresh Claude Code 5h window via session_quota bridge (BSH-147)
  await upsertProviderCreditSnapshot(db.raw(), {
    provider: "anthropic",
    asOf: new Date().toISOString(),
    remaining: 62,
    total: 100,
    unit: "percent",
    label: "quota_claude:5h_300m",
    source: "session_quota",
    status: "ok",
    surface: "plan_usage",
    details: {
      productLanguage: "Claude Code plan-usage window",
      limitId: "claude:5h",
      windowMinutes: 300,
      resetsAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    },
  });
  // Expired Claude 5h row — demoted at read time (BSH-96 / BSH-147)
  await upsertProviderCreditSnapshot(db.raw(), {
    provider: "anthropic",
    asOf: "2026-07-10T12:00:00.000Z",
    remaining: 55,
    total: 100,
    unit: "percent",
    label: "quota_claude:5h_300m_old",
    source: "session_quota",
    status: "ok",
    surface: "plan_usage",
    details: {
      productLanguage: "Claude Code plan-usage window",
      limitId: "claude:5h",
      windowMinutes: 300,
      resetsAt: "2026-07-10T17:00:00.000Z",
    },
  });

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

describe("GET /api/providers/status", () => {
  test("returns four providers without secrets", async () => {
    const res = await fetch(`${baseUrl}/api/providers/status`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.providers).toHaveLength(4);
    const ids = body.providers.map((p: { id: string }) => p.id).sort();
    expect(ids).toEqual(["anthropic", "openai", "openrouter", "xai"]);
    for (const p of body.providers) {
      expect(p).not.toHaveProperty("apiKey");
      // No live secret material in the payload (notes may mention key prefixes)
      expect(JSON.stringify(p)).not.toMatch(/sk-[a-zA-Z0-9]{10,}/);
      expect(Array.isArray(p.envVars)).toBe(true);
      expect(typeof p.status).toBe("string");
    }
  });
});

describe("GET /api/providers/usage", () => {
  test("returns API-sourced usage with source marker", async () => {
    const res = await fetch(`${baseUrl}/api/providers/usage`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.source).toBe("provider-api");
    expect(
      body.usage.some((u: { model: string }) => u.model === "test/model"),
    ).toBe(true);
  });
});

describe("GET /api/providers/usage/breakdown", () => {
  test("aggregates by provider and model", async () => {
    const res = await fetch(
      `${baseUrl}/api/providers/usage/breakdown?since=2026-07-01`,
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.source).toBe("provider-api");
    const row = body.breakdown.find(
      (r: { model: string }) => r.model === "test/model",
    );
    expect(row).toBeTruthy();
    expect(row.input_tokens).toBe(42);
    expect(row.cost_usd).toBeCloseTo(0.003);
  });

  test("accepts YYYY-MM-DD day keys for calendar ranges (BSH-97)", async () => {
    const res = await fetch(
      `${baseUrl}/api/providers/usage/breakdown?since=2026-07-10`,
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    const row = body.breakdown.find(
      (r: { model: string }) => r.model === "test/model",
    );
    expect(row).toBeTruthy();
    expect(row.input_tokens).toBe(42);
  });

  test("day key after usage day returns empty breakdown", async () => {
    const res = await fetch(
      `${baseUrl}/api/providers/usage/breakdown?since=2026-07-11`,
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    const row = body.breakdown.find(
      (r: { model: string }) => r.model === "test/model",
    );
    expect(row).toBeUndefined();
  });
});

describe("GET/PUT /api/providers/budget", () => {
  test("defaults to null budget and UTC timezone", async () => {
    const res = await fetch(`${baseUrl}/api/providers/budget`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.source).toBe("provider-api");
    expect(body.budget.monthlyBudgetUsd).toBeNull();
    expect(body.budget.timezone).toBe("UTC");
  });

  test("updates and clears monthly budget", async () => {
    const put = await fetch(`${baseUrl}/api/providers/budget`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        monthlyBudgetUsd: 250,
        timezone: "America/New_York",
      }),
    });
    const putBody = await put.json();
    expect(put.status).toBe(200);
    expect(putBody.budget.monthlyBudgetUsd).toBe(250);
    expect(putBody.budget.timezone).toBe("America/New_York");

    const get = await fetch(`${baseUrl}/api/providers/budget`);
    const getBody = await get.json();
    expect(getBody.budget.monthlyBudgetUsd).toBe(250);

    const clear = await fetch(`${baseUrl}/api/providers/budget`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ monthlyBudgetUsd: null }),
    });
    const clearBody = await clear.json();
    expect(clear.status).toBe(200);
    expect(clearBody.budget.monthlyBudgetUsd).toBeNull();
    // timezone preserved when omitted
    expect(clearBody.budget.timezone).toBe("America/New_York");
  });

  test("rejects invalid budget and timezone", async () => {
    const neg = await fetch(`${baseUrl}/api/providers/budget`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ monthlyBudgetUsd: -1 }),
    });
    expect(neg.status).toBe(400);

    const tz = await fetch(`${baseUrl}/api/providers/budget`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timezone: "Not/A_Zone" }),
    });
    expect(tz.status).toBe(400);
  });
});

describe("GET /api/providers/spend-insights", () => {
  test("returns budget progress meta and provider-api source", async () => {
    await fetch(`${baseUrl}/api/providers/budget`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ monthlyBudgetUsd: 100, timezone: "UTC" }),
    });

    const res = await fetch(`${baseUrl}/api/providers/spend-insights`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.meta.source).toBe("provider-api");
    expect(body.meta.timezone).toBe("UTC");
    expect(typeof body.budget.consumedUsd).toBe("number");
    expect(typeof body.burnRateUsdPerDay).toBe("number");
    expect(typeof body.forecastMonthEndUsd).toBe("number");
    expect(Array.isArray(body.dailyTrend)).toBe(true);
    expect(Array.isArray(body.topBreakdown)).toBe(true);
    expect(Array.isArray(body.anomalies)).toBe(true);
    expect(Array.isArray(body.syncWarnings)).toBe(true);
    expect(Array.isArray(body.meta.notes)).toBe(true);
    expect(body.meta.notes.some((n: string) => n.includes("session-log"))).toBe(
      true,
    );
    // BSH-105 extensions
    expect(body.forecast).toBeTruthy();
    expect(typeof body.forecast.confidence).toBe("number");
    expect(Array.isArray(body.forecast.incompleteDays)).toBe(true);
    expect(typeof body.meta.billingLagDays).toBe("number");
    expect(body.feeCategories).toBeTruthy();
    expect(typeof body.feeCategories.actualProviderSpendUsd).toBe("number");
    expect(Array.isArray(body.efficiency.provider)).toBe(true);
    expect(Array.isArray(body.recommendations)).toBe(true);
    expect(Array.isArray(body.alerts)).toBe(true);
    expect(Array.isArray(body.scopedBudgets)).toBe(true);
  });
});

describe("scoped budgets + alerts (BSH-105)", () => {
  test("CRUD scoped budgets", async () => {
    const put = await fetch(`${baseUrl}/api/providers/budgets`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scopeType: "provider",
        scopeKey: "openrouter",
        monthlyBudgetUsd: 50,
        warnThresholdPct: 75,
        criticalThresholdPct: 100,
      }),
    });
    const putBody = await put.json();
    expect(put.status).toBe(200);
    expect(putBody.budget.scopeType).toBe("provider");
    expect(putBody.budget.scopeKey).toBe("openrouter");
    expect(putBody.budget.monthlyBudgetUsd).toBe(50);

    const list = await fetch(`${baseUrl}/api/providers/budgets`);
    const listBody = await list.json();
    expect(list.status).toBe(200);
    expect(
      listBody.budgets.some(
        (b: { scopeKey: string }) => b.scopeKey === "openrouter",
      ),
    ).toBe(true);

    const id = putBody.budget.id as string;
    const del = await fetch(`${baseUrl}/api/providers/budgets/${id}`, {
      method: "DELETE",
    });
    expect(del.status).toBe(200);
  });

  test("rejects invalid scopeType", async () => {
    const res = await fetch(`${baseUrl}/api/providers/budgets`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scopeType: "wallet",
        scopeKey: "x",
        monthlyBudgetUsd: 1,
      }),
    });
    expect(res.status).toBe(400);
  });

  test("lists spend alerts endpoint", async () => {
    const res = await fetch(`${baseUrl}/api/providers/spend-alerts?limit=10`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.alerts)).toBe(true);
  });
});

describe("POST /api/providers/sync", () => {
  test("without keys marks not_configured and does not crash", async () => {
    const prev = {
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
      ANTHROPIC_ADMIN_KEY: process.env.ANTHROPIC_ADMIN_KEY,
      OPENAI_ADMIN_KEY: process.env.OPENAI_ADMIN_KEY,
      XAI_API_KEY: process.env.XAI_API_KEY,
    };
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.ANTHROPIC_ADMIN_KEY;
    delete process.env.OPENAI_ADMIN_KEY;
    delete process.env.XAI_API_KEY;

    try {
      const res = await fetch(`${baseUrl}/api/providers/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.results).toHaveLength(4);
      for (const r of body.results) {
        expect(r.status).toBe("not_configured");
      }

      const statusRes = await fetch(`${baseUrl}/api/providers/status`);
      const statusBody = await statusRes.json();
      for (const p of statusBody.providers) {
        expect(p.status).toBe("not_configured");
      }
    } finally {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});

describe("GET /api/providers/credits", () => {
  test("returns credit snapshots distinct from usage spend", async () => {
    const res = await fetch(`${baseUrl}/api/providers/credits`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.source).toBe("provider-credits");
    expect(Array.isArray(body.credits)).toBe(true);
    expect(Array.isArray(body.planUsage)).toBe(true);
    expect(Array.isArray(body.wallet)).toBe(true);
    const anthropic = body.wallet.find(
      (c: { provider: string; label: string }) =>
        c.provider === "anthropic" && c.label === "prepaid_balance",
    );
    expect(anthropic).toBeTruthy();
    expect(anthropic.status).toBe("unavailable");
    expect(anthropic.remaining).toBeNull();
    expect(anthropic.surface).toBe("wallet");
    const plan = body.planUsage.find(
      (c: { provider: string; label: string }) =>
        c.provider === "openai" && c.label === "quota_codex:primary_300m",
    );
    expect(plan).toBeTruthy();
    expect(plan.surface).toBe("plan_usage");
    expect(plan.remaining).toBe(80);
    expect(plan.status).toBe("ok");

    const expiredSecondary = body.planUsage.find(
      (c: { provider: string; label: string }) =>
        c.provider === "openai" && c.label === "quota_codex:secondary_10080m",
    );
    expect(expiredSecondary).toBeTruthy();
    expect(expiredSecondary.status).toBe("expired");
    expect(expiredSecondary.remaining).toBe(98);
    expect(String(expiredSecondary.details?.freshnessReason ?? "")).toMatch(
      /reset|elapsed/i,
    );

    // Anthropic planUsage includes bridged Claude Code session_quota rows
    const claudeFresh = body.planUsage.find(
      (c: { provider: string; label: string; status: string }) =>
        c.provider === "anthropic" &&
        c.label === "quota_claude:5h_300m" &&
        c.status === "ok",
    );
    expect(claudeFresh).toBeTruthy();
    expect(claudeFresh.remaining).toBe(62);
    expect(claudeFresh.source).toBe("session_quota");
    expect(claudeFresh.surface).toBe("plan_usage");

    const claudeExpired = body.planUsage.find(
      (c: { provider: string; label: string }) =>
        c.provider === "anthropic" && c.label === "quota_claude:5h_300m_old",
    );
    expect(claudeExpired).toBeTruthy();
    expect(claudeExpired.status).toBe("expired");

    // Response must not include secret-shaped strings
    expect(JSON.stringify(body)).not.toMatch(/sk-[a-zA-Z0-9]{10,}/);
  });
});

describe("capacity alert settings + persist (BSH-141)", () => {
  test("GET/PUT capacity-alert-settings", async () => {
    const getRes = await fetch(
      `${baseUrl}/api/providers/capacity-alert-settings`,
    );
    const getBody = await getRes.json();
    expect(getRes.status).toBe(200);
    expect(getBody.success).toBe(true);
    expect(getBody.settings.planUsageWarnRemainingPct).toBe(20);
    expect(getBody.settings.walletWarnRemainingUsd).toBe(10);

    const put = await fetch(
      `${baseUrl}/api/providers/capacity-alert-settings`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planUsageWarnRemainingPct: 25,
          planUsageCriticalRemainingPct: 8,
          walletWarnRemainingUsd: 15,
          walletCriticalRemainingUsd: 3,
        }),
      },
    );
    const putBody = await put.json();
    expect(put.status).toBe(200);
    expect(putBody.settings.planUsageWarnRemainingPct).toBe(25);
    expect(putBody.settings.walletCriticalRemainingUsd).toBe(3);

    const bad = await fetch(
      `${baseUrl}/api/providers/capacity-alert-settings`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planUsageWarnRemainingPct: 5,
          planUsageCriticalRemainingPct: 20,
        }),
      },
    );
    expect(bad.status).toBe(400);
  });

  test("credits GET persists quota alert for a fresh low window, not expired", async () => {
    await upsertProviderCreditSnapshot(db.raw(), {
      provider: "anthropic",
      asOf: new Date().toISOString(),
      remaining: 9,
      total: 100,
      unit: "percent",
      label: "quota_claude:weekly_10080m",
      source: "session_quota",
      status: "ok",
      surface: "plan_usage",
      details: {
        limitId: "claude:weekly",
        windowMinutes: 10080,
        resetsAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
      },
    });

    const creditsRes = await fetch(`${baseUrl}/api/providers/credits`);
    const creditsBody = await creditsRes.json();
    expect(creditsRes.status).toBe(200);
    expect(Array.isArray(creditsBody.capacityAlerts)).toBe(true);
    const quotaAlert = creditsBody.capacityAlerts.find(
      (a: { dataClass: string; scopeKey: string }) =>
        a.dataClass === "quota" && a.scopeKey.includes("claude:weekly"),
    );
    expect(quotaAlert).toBeTruthy();
    expect(quotaAlert.message).toMatch(/not Direct API Spend/i);

    const list = await fetch(
      `${baseUrl}/api/providers/spend-alerts?dataClass=quota&limit=20`,
    );
    const listBody = await list.json();
    expect(list.status).toBe(200);
    expect(
      listBody.alerts.some(
        (a: { dataClass: string; scopeKey: string }) =>
          a.dataClass === "quota" && a.scopeKey.includes("claude:weekly"),
      ),
    ).toBe(true);

    const expiredStill = listBody.alerts.filter(
      (a: { scopeKey: string }) =>
        typeof a.scopeKey === "string" && a.scopeKey.includes("5h_300m_old"),
    );
    expect(expiredStill).toHaveLength(0);
  });
});
