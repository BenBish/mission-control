import { describe, expect, test } from "bun:test";
import {
  shortWindowLabel,
  summarizePlanUsage,
  type PlanUsageCreditLike,
} from "../../lib/plan-usage.js";

function credit(
  partial: Partial<PlanUsageCreditLike> &
    Pick<PlanUsageCreditLike, "provider" | "label" | "remaining" | "status">,
): PlanUsageCreditLike {
  return {
    unit: "percent",
    ...partial,
  };
}

describe("shortWindowLabel", () => {
  test("maps claude 5h and weekly windows", () => {
    expect(
      shortWindowLabel("quota_claude:5h_300m", {
        limitId: "claude:5h",
        windowMinutes: 300,
      }),
    ).toBe("5h");
    expect(
      shortWindowLabel("quota_claude:7d_10080m", {
        limitId: "claude:7d",
        windowMinutes: 10080,
      }),
    ).toBe("wk");
    expect(
      shortWindowLabel("quota_codex:primary_300m", { windowMinutes: 300 }),
    ).toBe("5h");
  });
});

describe("summarizePlanUsage", () => {
  test("picks lowest remaining fresh window per provider and overall", () => {
    const summary = summarizePlanUsage([
      credit({
        provider: "anthropic",
        label: "quota_claude:5h_300m",
        remaining: 62,
        status: "ok",
        details: { limitId: "claude:5h", windowMinutes: 300 },
      }),
      credit({
        provider: "anthropic",
        label: "quota_claude:7d_10080m",
        remaining: 88,
        status: "ok",
        details: { limitId: "claude:7d", windowMinutes: 10080 },
      }),
      credit({
        provider: "openai",
        label: "quota_codex:primary_300m",
        remaining: 40,
        status: "ok",
        details: { windowMinutes: 300 },
      }),
      credit({
        provider: "openai",
        label: "quota_codex:secondary_10080m",
        remaining: 10,
        status: "expired",
        details: { windowMinutes: 10080 },
      }),
    ]);

    expect(summary.hasFresh).toBe(true);
    expect(summary.mostConstrained?.provider).toBe("openai");
    expect(summary.mostConstrained?.remainingPercent).toBe(40);
    expect(summary.mostConstrained?.windowLabel).toBe("5h");
    expect(summary.perProvider).toHaveLength(2);
    const anth = summary.perProvider.find((p) => p.provider === "anthropic");
    expect(anth?.remainingPercent).toBe(62);
    expect(anth?.windowLabel).toBe("5h");
    expect(anth?.displayName).toBe("Claude");
  });

  test("excludes non-ok statuses and empty input", () => {
    expect(summarizePlanUsage([]).hasFresh).toBe(false);
    expect(summarizePlanUsage([]).mostConstrained).toBeNull();
    const onlyExpired = summarizePlanUsage([
      credit({
        provider: "anthropic",
        label: "quota_claude:5h_300m",
        remaining: 50,
        status: "expired",
      }),
      credit({
        provider: "openai",
        label: "quota_x",
        remaining: 1,
        status: "stale",
      }),
    ]);
    expect(onlyExpired.hasFresh).toBe(false);
    expect(onlyExpired.mostConstrained).toBeNull();
  });
});
