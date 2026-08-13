import { describe, expect, test } from "bun:test";
import {
  buildDashboardAttentionItems,
  resolveAttentionHref,
} from "../../lib/dashboard-attention";
import type { PlanUsageSummary } from "../../lib/plan-usage";
import type { SpendAlert } from "../../lib/queries";

function planUsage(
  remainingPercent: number,
  overrides: Partial<PlanUsageSummary["mostConstrained"]> = {},
): PlanUsageSummary {
  const mostConstrained = {
    provider: "anthropic",
    displayName: "Claude",
    remainingPercent,
    windowLabel: "5h",
    label: "quota_claude:5h_300m",
    fiveHour: {
      slot: "5h" as const,
      windowLabel: "5h",
      remainingPercent,
      status: "ok",
      label: "quota_claude:5h_300m",
    },
    weekly: {
      slot: "wk" as const,
      windowLabel: "wk",
      remainingPercent: 80,
      status: "ok",
      label: "quota_claude:7d_10080m",
    },
    extras: [],
    ...overrides,
  };
  return {
    mostConstrained,
    perProvider: [mostConstrained],
    hasFresh: true,
  };
}

function alert(
  partial: Partial<SpendAlert> & Pick<SpendAlert, "id" | "title">,
): SpendAlert {
  return {
    kind: "threshold",
    severity: "warn",
    dataClass: "quota",
    scopeType: "quota",
    scopeKey: "anthropic",
    message: "Claude 5h window is at 12% remaining.",
    evidence: null,
    estimatedImpactUsd: null,
    deliveryState: "delivered",
    deliveredAt: "2026-08-13T12:00:00.000Z",
    acknowledgedAt: null,
    fingerprint: `fp-${partial.id}`,
    monthKey: "2026-08",
    createdAt: "2026-08-13T12:00:00.000Z",
    updatedAt: "2026-08-13T12:00:00.000Z",
    ...partial,
  };
}

describe("resolveAttentionHref", () => {
  test("maps hash hints onto the consumption direct-api view", () => {
    expect(resolveAttentionHref("#direct-api-drivers")).toBe(
      "/consumption?view=direct-api#direct-api-drivers",
    );
    expect(resolveAttentionHref("/failures")).toBe("/failures");
    expect(resolveAttentionHref(null)).toBe("/consumption?view=direct-api");
  });
});

describe("buildDashboardAttentionItems", () => {
  test("returns empty when nothing needs attention", () => {
    expect(
      buildDashboardAttentionItems({
        failureLast24Hours: 0,
        openRuntimeEvents: 0,
        planUsage: { mostConstrained: null, perProvider: [], hasFresh: false },
      }),
    ).toEqual([]);
  });

  test("summarizes failures separately from the raw activity feed", () => {
    const items = buildDashboardAttentionItems({
      failureLast24Hours: 3,
      openRuntimeEvents: 2,
    });
    expect(items[0]?.kind).toBe("failure");
    expect(items[0]?.href).toBe("/failures");
    expect(items[0]?.detail).toContain("3 in the last 24 hours");
    expect(items[0]?.detail).toContain("2 open runtime");
    expect(items[0]?.severity).toBe("warn");
  });

  test("treats a large failure burst as critical", () => {
    const items = buildDashboardAttentionItems({
      failureLast24Hours: 12,
      openRuntimeEvents: 0,
    });
    expect(items[0]?.severity).toBe("critical");
  });

  test("surfaces live plan-usage risk without treating percent as dollars", () => {
    const items = buildDashboardAttentionItems({
      planUsage: planUsage(12),
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe("plan-usage");
    expect(items[0]?.severity).toBe("warn");
    expect(items[0]?.detail).toMatch(/12% remaining/);
    expect(items[0]?.detail).toMatch(/not dollars/i);
    expect(items[0]?.href).toContain("#capacity");
  });

  test("uses critical plan-usage threshold when remaining is at or below it", () => {
    const items = buildDashboardAttentionItems({
      planUsage: planUsage(4),
    });
    expect(items[0]?.severity).toBe("critical");
  });

  test("does not duplicate a live plan-usage row when a quota alert exists", () => {
    const items = buildDashboardAttentionItems({
      planUsage: planUsage(12),
      alerts: [
        alert({
          id: "a1",
          title: "Claude 5h window is low",
          dataClass: "quota",
        }),
      ],
    });
    expect(items.filter((i) => i.kind === "plan-usage")).toHaveLength(1);
    expect(items[0]?.id).toBe("alert:a1");
  });

  test("ignores acknowledged and suppressed alerts", () => {
    const items = buildDashboardAttentionItems({
      alerts: [
        alert({
          id: "ack",
          title: "Old quota warning",
          deliveryState: "acknowledged",
        }),
        alert({
          id: "sup",
          title: "Suppressed wallet",
          dataClass: "wallet",
          deliveryState: "suppressed",
        }),
      ],
    });
    expect(items).toEqual([]);
  });

  test("flags account budget risk from spend insights", () => {
    const items = buildDashboardAttentionItems({
      budget: {
        monthlyBudgetUsd: 50,
        consumedUsd: 44,
        remainingUsd: 6,
        consumedPct: 88,
      },
    });
    expect(items[0]?.kind).toBe("budget");
    expect(items[0]?.severity).toBe("warn");
    expect(items[0]?.title).toMatch(/at risk/i);
  });

  test("includes notable spend movers above the delta floor", () => {
    const items = buildDashboardAttentionItems({
      topBreakdown: [
        {
          provider: "openrouter",
          model: "gpt-4o",
          costUsd: 12,
          inputTokens: 1,
          outputTokens: 1,
          priorPeriodCostUsd: 4,
          deltaUsd: 8,
          deltaPct: 200,
        },
        {
          provider: "anthropic",
          model: "claude-sonnet",
          costUsd: 3,
          inputTokens: 1,
          outputTokens: 1,
          priorPeriodCostUsd: 2.8,
          deltaUsd: 0.2,
          deltaPct: 7,
        },
      ],
    });
    const mover = items.find((i) => i.kind === "spend-mover");
    expect(mover?.title).toMatch(/openrouter gpt-4o/i);
    expect(mover?.detail).toMatch(/\+\$8/);
    expect(mover?.href).toContain("direct-api");
  });

  test("caps the list and sorts critical before info", () => {
    const items = buildDashboardAttentionItems({
      failureLast24Hours: 12,
      planUsage: planUsage(4),
      budget: {
        monthlyBudgetUsd: 20,
        consumedUsd: 25,
        remainingUsd: -5,
        consumedPct: 125,
      },
      topBreakdown: [
        {
          provider: "xai",
          model: "grok-4",
          costUsd: 9,
          inputTokens: 1,
          outputTokens: 1,
          priorPeriodCostUsd: 2,
          deltaUsd: 7,
          deltaPct: 350,
        },
      ],
      recommendations: [
        {
          kind: "cache_opportunity",
          title: "Turn on prompt caching",
          message: "Estimated $3/mo savings.",
          estimatedImpactUsd: 3,
          costClass: "estimated",
          evidence: {},
          hrefHint: "#direct-api-efficiency",
        },
      ],
    });
    expect(items.length).toBeLessThanOrEqual(5);
    expect(items[0]?.severity).toBe("critical");
    expect(items.map((i) => i.kind)).toContain("failure");
  });
});
