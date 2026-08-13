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
    expect(
      shortWindowLabel("quota_grok:week_10080m", {
        limitId: "grok:week",
        windowMinutes: 10080,
      }),
    ).toBe("wk");
    expect(
      shortWindowLabel("quota_claude:7d_opus_10080m", {
        limitId: "claude:7d_opus",
        windowMinutes: 10080,
      }),
    ).toBe("Opus wk");
  });
});

describe("summarizePlanUsage", () => {
  test("picks lowest remaining fresh canonical window per provider and overall", () => {
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
    expect(anth?.fiveHour.remainingPercent).toBe(62);
    expect(anth?.weekly.remainingPercent).toBe(88);
    expect(anth?.fiveHour.status).toBe("ok");
    expect(anth?.weekly.status).toBe("ok");
  });

  test("presents unavailable 5h when OpenAI primary is missing", () => {
    const summary = summarizePlanUsage([
      credit({
        provider: "openai",
        label: "quota_codex:secondary_10080m",
        remaining: 40,
        status: "ok",
        details: { limitId: "codex:secondary", windowMinutes: 10080 },
      }),
    ]);
    const openai = summary.perProvider.find((p) => p.provider === "openai");
    expect(openai?.fiveHour.status).toBe("unavailable");
    expect(openai?.fiveHour.remainingPercent).toBeNull();
    expect(openai?.weekly.status).toBe("ok");
    expect(openai?.weekly.remainingPercent).toBe(40);
    expect(summary.mostConstrained?.windowLabel).toBe("wk");
  });

  test("keeps expired OpenAI primary as the 5h slot instead of hiding it", () => {
    const summary = summarizePlanUsage([
      credit({
        provider: "openai",
        label: "quota_codex:primary_300m",
        remaining: 12,
        status: "expired",
        details: { limitId: "codex:primary", windowMinutes: 300 },
      }),
      credit({
        provider: "openai",
        label: "quota_codex:secondary_10080m",
        remaining: 55,
        status: "ok",
        details: { limitId: "codex:secondary", windowMinutes: 10080 },
      }),
    ]);
    const openai = summary.perProvider.find((p) => p.provider === "openai");
    expect(openai?.fiveHour.status).toBe("expired");
    expect(openai?.fiveHour.remainingPercent).toBe(12);
    expect(openai?.weekly.status).toBe("ok");
    expect(openai?.weekly.remainingPercent).toBe(55);
    expect(summary.mostConstrained?.windowLabel).toBe("wk");
    expect(summary.mostConstrained?.remainingPercent).toBe(55);
  });

  test("does not mix Claude Opus weekly into the weekly slot", () => {
    const summary = summarizePlanUsage([
      credit({
        provider: "anthropic",
        label: "quota_claude:7d_10080m",
        remaining: 80,
        status: "ok",
        details: { limitId: "claude:7d", windowMinutes: 10080 },
      }),
      credit({
        provider: "anthropic",
        label: "quota_claude:7d_opus_10080m",
        remaining: 5,
        status: "ok",
        details: { limitId: "claude:7d_opus", windowMinutes: 10080 },
      }),
    ]);
    const anth = summary.perProvider.find((p) => p.provider === "anthropic");
    expect(anth?.weekly.remainingPercent).toBe(80);
    expect(anth?.fiveHour.status).toBe("unavailable");
    expect(anth?.extras).toHaveLength(1);
    expect(anth?.extras[0].windowLabel).toBe("Opus wk");
    expect(anth?.extras[0].remainingPercent).toBe(5);
    expect(summary.mostConstrained?.remainingPercent).toBe(80);
  });

  test("maps Grok weekly and leaves 5h unavailable", () => {
    const summary = summarizePlanUsage([
      credit({
        provider: "xai",
        label: "quota_grok:week_10080m",
        remaining: 47,
        status: "ok",
        details: { limitId: "grok:week", windowMinutes: 10080 },
      }),
    ]);
    const grok = summary.perProvider.find((p) => p.provider === "xai");
    expect(grok?.displayName).toBe("xAI");
    expect(grok?.weekly.remainingPercent).toBe(47);
    expect(grok?.fiveHour.status).toBe("unavailable");
    expect(summary.mostConstrained?.provider).toBe("xai");
  });

  test("excludes non-ok statuses and empty input from the KPI headline", () => {
    expect(summarizePlanUsage([]).hasFresh).toBe(false);
    expect(summarizePlanUsage([]).mostConstrained).toBeNull();
    const onlyExpired = summarizePlanUsage([
      credit({
        provider: "anthropic",
        label: "quota_claude:5h_300m",
        remaining: 50,
        status: "expired",
        details: { limitId: "claude:5h", windowMinutes: 300 },
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
    expect(onlyExpired.perProvider).toHaveLength(2);
    const anth = onlyExpired.perProvider.find(
      (p) => p.provider === "anthropic",
    );
    expect(anth?.fiveHour.status).toBe("expired");
  });
});
