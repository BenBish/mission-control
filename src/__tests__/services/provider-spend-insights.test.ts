import { describe, expect, test } from "bun:test";
import type { ProviderUsageRow } from "../../db/queries/provider-usage.js";
import {
  ANOMALY_MIN_USD,
  addDays,
  computeForecast,
  computeSpendInsights,
  daysInCalendarMonth,
  detectAnomalies,
  evaluateScopedBudgets,
  evaluateSyncWarnings,
  formatDayInTimeZone,
  incompleteDaysFor,
  listDaysInclusive,
} from "../../services/provider-spend-insights.js";

function row(
  partial: Partial<ProviderUsageRow> &
    Pick<ProviderUsageRow, "provider" | "day" | "model" | "cost_usd">,
): ProviderUsageRow {
  return {
    input_tokens: 100,
    output_tokens: 50,
    request_count: 1,
    updated_at: null,
    ...partial,
  };
}

describe("date helpers", () => {
  test("formatDayInTimeZone UTC", () => {
    const d = new Date("2026-07-15T12:00:00.000Z");
    expect(formatDayInTimeZone(d, "UTC")).toBe("2026-07-15");
  });

  test("daysInCalendarMonth", () => {
    expect(daysInCalendarMonth(2026, 2)).toBe(28);
    expect(daysInCalendarMonth(2024, 2)).toBe(29);
    expect(daysInCalendarMonth(2026, 7)).toBe(31);
  });

  test("addDays and listDaysInclusive", () => {
    expect(addDays("2026-07-30", 1)).toBe("2026-07-31");
    expect(addDays("2026-07-31", 1)).toBe("2026-08-01");
    expect(listDaysInclusive("2026-07-01", "2026-07-03")).toEqual([
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
    ]);
  });
});

describe("computeSpendInsights", () => {
  const now = new Date("2026-07-15T18:00:00.000Z");

  test("sums MTD provider costs only and forecasts from burn", () => {
    const usage: ProviderUsageRow[] = [
      row({
        provider: "openrouter",
        day: "2026-07-01",
        model: "a",
        cost_usd: 10,
      }),
      row({
        provider: "anthropic",
        day: "2026-07-10",
        model: "b",
        cost_usd: 20,
      }),
      // prior month
      row({
        provider: "openrouter",
        day: "2026-06-01",
        model: "a",
        cost_usd: 5,
      }),
      row({
        provider: "openrouter",
        day: "2026-06-10",
        model: "a",
        cost_usd: 8,
      }),
      // outside window
      row({
        provider: "openai",
        day: "2026-05-01",
        model: "c",
        cost_usd: 100,
      }),
    ];

    const insights = computeSpendInsights({
      usage,
      syncStatus: [
        {
          provider: "openrouter",
          status: "ok",
          last_sync_at: "2026-07-15 12:00:00",
          last_success_at: "2026-07-15 12:00:00",
          last_error: null,
          cursor_day: null,
          meta_json: null,
          updated_at: null,
        },
      ],
      configuredProviderIds: ["openrouter"],
      budget: { monthlyBudgetUsd: 100, timezone: "UTC" },
      now,
    });

    expect(insights.budget.consumedUsd).toBeCloseTo(30);
    expect(insights.budget.remainingUsd).toBeCloseTo(70);
    expect(insights.budget.consumedPct).toBeCloseTo(30);
    expect(insights.meta.daysElapsed).toBe(15);
    expect(insights.meta.daysInMonth).toBe(31);
    expect(insights.meta.partialMonth).toBe(true);
    expect(insights.burnRateUsdPerDay).toBeCloseTo(30 / 15);
    expect(insights.forecastMonthEndUsd).toBeCloseTo((30 / 15) * 31);
    expect(insights.meta.source).toBe("provider-api");
    expect(insights.meta.forecastReliable).toBe(true);
    expect(insights.dailyTrend).toHaveLength(15);
    expect(insights.dailyTrend[0].day).toBe("2026-07-01");
    expect(insights.dailyTrend[0].costUsd).toBe(10);
    expect(insights.dailyTrend[0].priorPeriodCostUsd).toBe(5);

    const top = insights.topBreakdown.find(
      (r) => r.provider === "anthropic" && r.model === "b",
    );
    expect(top?.costUsd).toBe(20);
  });

  test("null budget leaves remaining null", () => {
    const insights = computeSpendInsights({
      usage: [],
      syncStatus: [],
      configuredProviderIds: ["openrouter"],
      budget: { monthlyBudgetUsd: null, timezone: "UTC" },
      now,
      // fresh success via evaluate — force reliable path with empty warnings that aren't stale
    });
    // No configured success → unreliable, but budget fields still work
    expect(insights.budget.monthlyBudgetUsd).toBeNull();
    expect(insights.budget.remainingUsd).toBeNull();
    expect(insights.budget.consumedPct).toBeNull();
  });

  test("stale configured sync marks forecast unreliable", () => {
    const insights = computeSpendInsights({
      usage: [
        row({
          provider: "openrouter",
          day: "2026-07-01",
          model: "a",
          cost_usd: 1,
        }),
      ],
      syncStatus: [
        {
          provider: "openrouter",
          status: "ok",
          last_sync_at: "2026-07-01 00:00:00",
          last_success_at: "2026-07-01 00:00:00",
          last_error: null,
          cursor_day: null,
          meta_json: null,
          updated_at: null,
        },
      ],
      configuredProviderIds: ["openrouter"],
      budget: { monthlyBudgetUsd: 50, timezone: "UTC" },
      now,
    });

    expect(insights.meta.forecastReliable).toBe(false);
    expect(
      insights.syncWarnings.some(
        (w) => w.provider === "openrouter" && w.reason === "stale",
      ),
    ).toBe(true);
  });

  test("error status marks forecast unreliable", () => {
    const insights = computeSpendInsights({
      usage: [],
      syncStatus: [
        {
          provider: "anthropic",
          status: "error",
          last_sync_at: "2026-07-15 17:00:00",
          last_success_at: "2026-07-15 17:00:00",
          last_error: "401",
          cursor_day: null,
          meta_json: null,
          updated_at: null,
        },
      ],
      configuredProviderIds: ["anthropic"],
      budget: { monthlyBudgetUsd: null, timezone: "UTC" },
      now,
    });
    expect(insights.meta.forecastReliable).toBe(false);
    expect(
      insights.syncWarnings.some(
        (w) => w.reason === "error" && w.lastError === "401",
      ),
    ).toBe(true);
  });

  test("fresh sync history without env keys is still reliable", () => {
    const insights = computeSpendInsights({
      usage: [
        row({
          provider: "openrouter",
          day: "2026-07-01",
          model: "a",
          cost_usd: 2,
        }),
      ],
      syncStatus: [
        {
          provider: "openrouter",
          status: "ok",
          last_sync_at: "2026-07-15 12:00:00",
          last_success_at: "2026-07-15 12:00:00",
          last_error: null,
          cursor_day: null,
          meta_json: null,
          updated_at: null,
        },
      ],
      configuredProviderIds: [], // no env keys
      budget: { monthlyBudgetUsd: 50, timezone: "UTC" },
      now,
    });
    expect(insights.meta.forecastReliable).toBe(true);
    expect(insights.syncWarnings.some((w) => w.reason === "no_sync_data")).toBe(
      false,
    );
    // Still surfaces not_configured for re-sync awareness
    expect(
      insights.syncWarnings.some(
        (w) => w.provider === "openrouter" && w.reason === "not_configured",
      ),
    ).toBe(true);
  });
});

describe("detectAnomalies", () => {
  test("flags day ≥2× 7-day baseline and ≥$1", () => {
    const usage: ProviderUsageRow[] = [];
    // baseline ~1/day for a week before July 10
    for (let i = 1; i <= 7; i++) {
      usage.push(
        row({
          provider: "openrouter",
          day: `2026-07-0${i}`,
          model: "m",
          cost_usd: 1,
        }),
      );
    }
    // spike day
    usage.push(
      row({
        provider: "openrouter",
        day: "2026-07-10",
        model: "m",
        cost_usd: 10,
      }),
    );

    const anomalies = detectAnomalies(usage, "2026-07-01", "2026-07-15");
    const daily = anomalies.find(
      (a) => a.kind === "daily" && a.day === "2026-07-10",
    );
    expect(daily).toBeTruthy();
    expect(daily!.valueUsd).toBe(10);
    expect(daily!.baselineUsd).toBeGreaterThan(0);
    expect(daily!.ratio).toBeGreaterThanOrEqual(2);

    const pm = anomalies.find(
      (a) =>
        a.kind === "provider_model" &&
        a.day === "2026-07-10" &&
        a.provider === "openrouter",
    );
    expect(pm).toBeTruthy();
  });

  test("does not flag below absolute floor", () => {
    const usage: ProviderUsageRow[] = [
      row({
        provider: "xai",
        day: "2026-07-01",
        model: "g",
        cost_usd: 0.1,
      }),
      row({
        provider: "xai",
        day: "2026-07-08",
        model: "g",
        cost_usd: 0.5,
      }),
    ];
    const anomalies = detectAnomalies(usage, "2026-07-01", "2026-07-15");
    expect(anomalies.every((a) => a.valueUsd >= ANOMALY_MIN_USD)).toBe(true);
    expect(anomalies.filter((a) => a.day === "2026-07-08")).toHaveLength(0);
  });

  test("does not flag early sparse days without enough baseline samples", () => {
    const usage: ProviderUsageRow[] = [
      row({
        provider: "openrouter",
        day: "2026-07-01",
        model: "m",
        cost_usd: 12,
      }),
      row({
        provider: "openrouter",
        day: "2026-07-10",
        model: "m",
        cost_usd: 50,
      }),
    ];
    const anomalies = detectAnomalies(usage, "2026-07-01", "2026-07-15");
    // Only two non-zero history days total — neither day has ≥3 prior non-zero samples
    expect(anomalies).toHaveLength(0);
  });
});

describe("evaluateSyncWarnings", () => {
  test("no observed sync history is unreliable with no_sync_data", () => {
    const { forecastReliable, warnings } = evaluateSyncWarnings(
      [],
      [],
      new Date("2026-07-15T00:00:00Z"),
      36 * 60 * 60 * 1000,
    );
    expect(forecastReliable).toBe(false);
    expect(warnings.some((w) => w.reason === "no_sync_data")).toBe(true);
    expect(warnings.some((w) => w.reason === "not_configured")).toBe(true);
  });

  test("error in DB without env keys still surfaces as error", () => {
    const { forecastReliable, warnings } = evaluateSyncWarnings(
      [
        {
          provider: "anthropic",
          status: "error",
          last_sync_at: "2026-07-15 17:00:00",
          last_success_at: "2026-07-15 17:00:00",
          last_error: "401",
          cursor_day: null,
          meta_json: null,
          updated_at: null,
        },
      ],
      [],
      new Date("2026-07-15T18:00:00Z"),
      36 * 60 * 60 * 1000,
    );
    expect(forecastReliable).toBe(false);
    expect(
      warnings.some((w) => w.reason === "error" && w.provider === "anthropic"),
    ).toBe(true);
  });
});

describe("BSH-105 forecast incomplete days and confidence", () => {
  test("incompleteDaysFor labels today and billing lag window", () => {
    const days = incompleteDaysFor("2026-07-01", "2026-07-15", 2);
    expect(days).toEqual(["2026-07-13", "2026-07-14", "2026-07-15"]);
  });

  test("trailing forecast excludes incomplete days and reports confidence range", () => {
    const dayTotals = new Map<string, number>();
    for (let d = 1; d <= 15; d++) {
      const day = `2026-07-${String(d).padStart(2, "0")}`;
      dayTotals.set(day, d === 15 ? 0 : 2); // today incomplete/zero-ish
    }
    const incomplete = incompleteDaysFor("2026-07-01", "2026-07-15", 2);
    const forecast = computeForecast({
      dayTotals,
      monthStart: "2026-07-01",
      today: "2026-07-15",
      daysInMonth: 31,
      daysElapsed: 15,
      incompleteDays: incomplete,
      billingLagDays: 2,
      method: "trailing_7d",
      excludeIncompleteFromBurn: true,
      forecastReliableFromSync: true,
    });
    expect(forecast.incompleteDays).toEqual(incomplete);
    expect(forecast.incompleteDayTreatment).toBe("excluded_from_burn");
    expect(forecast.billingLagDays).toBe(2);
    expect(forecast.daysUsed).toBeGreaterThan(0);
    expect(forecast.lowUsd).toBeLessThanOrEqual(forecast.pointUsd);
    expect(forecast.highUsd).toBeGreaterThanOrEqual(forecast.pointUsd);
    expect(forecast.confidence).toBeGreaterThan(0);
    expect(forecast.confidence).toBeLessThanOrEqual(0.95);
    expect(forecast.notes.some((n) => n.includes("Incomplete days"))).toBe(
      true,
    );
  });

  test("sparse data lowers confidence vs dense complete history", () => {
    const sparse = new Map<string, number>([["2026-07-14", 5]]);
    const dense = new Map<string, number>();
    for (let d = 1; d <= 14; d++) {
      dense.set(`2026-07-${String(d).padStart(2, "0")}`, 2);
    }
    const incomplete = incompleteDaysFor("2026-07-01", "2026-07-15", 1);
    const sparseF = computeForecast({
      dayTotals: sparse,
      monthStart: "2026-07-01",
      today: "2026-07-15",
      daysInMonth: 31,
      daysElapsed: 15,
      incompleteDays: incomplete,
      billingLagDays: 1,
      method: "simple_mtd",
      excludeIncompleteFromBurn: true,
      forecastReliableFromSync: true,
    });
    const denseF = computeForecast({
      dayTotals: dense,
      monthStart: "2026-07-01",
      today: "2026-07-15",
      daysInMonth: 31,
      daysElapsed: 15,
      incompleteDays: incomplete,
      billingLagDays: 1,
      method: "simple_mtd",
      excludeIncompleteFromBurn: true,
      forecastReliableFromSync: true,
    });
    expect(sparseF.confidence).toBeLessThan(denseF.confidence);
  });

  test("late billing lag widens incomplete set and is documented", () => {
    const dayTotals = new Map<string, number>();
    for (let d = 1; d <= 15; d++) {
      dayTotals.set(`2026-07-${String(d).padStart(2, "0")}`, 3);
    }
    const lag0 = computeForecast({
      dayTotals,
      monthStart: "2026-07-01",
      today: "2026-07-15",
      daysInMonth: 31,
      daysElapsed: 15,
      incompleteDays: incompleteDaysFor("2026-07-01", "2026-07-15", 0),
      billingLagDays: 0,
      method: "trailing_7d",
      excludeIncompleteFromBurn: true,
      forecastReliableFromSync: true,
    });
    const lag5 = computeForecast({
      dayTotals,
      monthStart: "2026-07-01",
      today: "2026-07-15",
      daysInMonth: 31,
      daysElapsed: 15,
      incompleteDays: incompleteDaysFor("2026-07-01", "2026-07-15", 5),
      billingLagDays: 5,
      method: "trailing_7d",
      excludeIncompleteFromBurn: true,
      forecastReliableFromSync: true,
    });
    expect(lag5.incompleteDays.length).toBeGreaterThan(
      lag0.incompleteDays.length,
    );
    expect(lag5.daysUsed).toBeLessThanOrEqual(lag0.daysUsed);
    expect(lag5.notes.some((n) => n.includes("billing lag"))).toBe(true);
  });

  test("computeSpendInsights surfaces forecast meta, efficiency, fee classes", () => {
    const insights = computeSpendInsights({
      usage: [
        row({
          provider: "openrouter",
          day: "2026-07-01",
          model: "a",
          cost_usd: 10,
          request_count: 5,
          output_tokens: 1000,
        }),
        row({
          provider: "openrouter",
          day: "2026-07-10",
          model: "b",
          cost_usd: 20,
          request_count: 2,
          output_tokens: 500,
        }),
      ],
      syncStatus: [
        {
          provider: "openrouter",
          status: "ok",
          last_sync_at: "2026-07-15 12:00:00",
          last_success_at: "2026-07-15 12:00:00",
          last_error: null,
          cursor_day: null,
          meta_json: null,
          updated_at: null,
        },
      ],
      configuredProviderIds: ["openrouter"],
      budget: { monthlyBudgetUsd: 100, timezone: "UTC" },
      now: new Date("2026-07-15T18:00:00.000Z"),
      forecastMethod: "trailing_7d",
      billingLagDays: 2,
      agentFacts: [],
      failureWasteUsd: null,
    });

    expect(insights.forecast.method).toBe("trailing_7d");
    expect(insights.meta.billingLagDays).toBe(2);
    expect(insights.meta.incompleteDays.length).toBeGreaterThan(0);
    expect(insights.feeCategories.actualProviderSpendUsd).toBeCloseTo(30);
    expect(insights.feeCategories.notes.some((n) => n.includes("never"))).toBe(
      true,
    );
    expect(insights.efficiency.provider.length).toBeGreaterThan(0);
    const overall = insights.efficiency.provider.find(
      (s) => s.dimension === "overall",
    );
    expect(overall?.costPerRequest).toBeCloseTo(30 / 7);
    expect(insights.scopedBudgets).toEqual([]);
  });

  test("scoped budgets evaluate provider and account progress", () => {
    const usage = [
      row({
        provider: "openrouter",
        day: "2026-07-05",
        model: "a",
        cost_usd: 40,
      }),
      row({
        provider: "anthropic",
        day: "2026-07-05",
        model: "b",
        cost_usd: 10,
      }),
    ];
    const progress = evaluateScopedBudgets(
      [
        {
          id: "1",
          scopeType: "account",
          scopeKey: "*",
          monthlyBudgetUsd: 100,
          warnThresholdPct: 80,
          criticalThresholdPct: 100,
          enabled: true,
          createdAt: null,
          updatedAt: null,
        },
        {
          id: "2",
          scopeType: "provider",
          scopeKey: "openrouter",
          monthlyBudgetUsd: 30,
          warnThresholdPct: 80,
          criticalThresholdPct: 100,
          enabled: true,
          createdAt: null,
          updatedAt: null,
        },
      ],
      usage,
    );
    expect(progress[0].consumedUsd).toBeCloseTo(50);
    expect(progress[0].status).toBe("ok");
    expect(progress[1].consumedUsd).toBeCloseTo(40);
    expect(progress[1].status).toBe("critical");
  });
});
