import { describe, expect, test } from "bun:test";
import type { AgentUsageDailyFactRow } from "../../db/queries/agent-usage.js";
import type { ProviderUsageRow } from "../../db/queries/provider-usage.js";
import {
  buildReconciliationReport,
  EXACT_TOKEN_RATIO,
  filterProviderRows,
  parseByokTreatment,
  parseProviderList,
} from "../../services/spend-reconciliation.js";

function provider(
  partial: Partial<ProviderUsageRow> &
    Pick<ProviderUsageRow, "provider" | "day" | "model">,
): ProviderUsageRow {
  return {
    input_tokens: 1000,
    output_tokens: 200,
    cost_usd: 1.5,
    request_count: 3,
    updated_at: "2026-08-05T12:00:00.000Z",
    ...partial,
  };
}

function agent(
  partial: Partial<AgentUsageDailyFactRow> &
    Pick<AgentUsageDailyFactRow, "day" | "model">,
): AgentUsageDailyFactRow {
  return {
    source_id: "claude-code",
    input_tokens: 1000,
    output_tokens: 200,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    cost_usd: null,
    request_count: 3,
    ...partial,
  };
}

describe("parse helpers", () => {
  test("parseByokTreatment defaults and validates", () => {
    expect(parseByokTreatment(undefined)).toBe("flag_overlap");
    expect(parseByokTreatment("prefer_direct")).toBe("prefer_direct");
    expect(parseByokTreatment("nope")).toBe("flag_overlap");
  });

  test("parseProviderList filters unknown ids", () => {
    expect(parseProviderList("anthropic,openrouter,foo")).toEqual([
      "anthropic",
      "openrouter",
    ]);
    expect(parseProviderList("")).toBeNull();
  });
});

describe("filterProviderRows", () => {
  const rows = [
    provider({ provider: "openrouter", day: "2026-08-01", model: "gpt-4o" }),
    provider({
      provider: "anthropic",
      day: "2026-08-01",
      model: "claude-sonnet-4",
    }),
    provider({ provider: "openai", day: "2026-08-01", model: "gpt-4o" }),
  ];

  test("include + exclude", () => {
    const filtered = filterProviderRows(rows, {
      includeProviders: ["openrouter", "anthropic", "openai"],
      excludeProviders: ["openai"],
    });
    expect(filtered.map((r) => r.provider).sort()).toEqual([
      "anthropic",
      "openrouter",
    ]);
  });

  test("exclude_openrouter drops openrouter rows", () => {
    const filtered = filterProviderRows(rows, {
      byokTreatment: "exclude_openrouter",
    });
    expect(filtered.every((r) => r.provider !== "openrouter")).toBe(true);
  });
});

describe("buildReconciliationReport", () => {
  test("exact match when day + model + tokens within band", () => {
    const report = buildReconciliationReport(
      [
        provider({
          provider: "anthropic",
          day: "2026-08-01",
          model: "claude-3-5-sonnet-20241022",
          input_tokens: 1000,
          output_tokens: 200,
          cost_usd: 2,
        }),
      ],
      [
        agent({
          day: "2026-08-01",
          model: "claude-3-5-sonnet-20240620",
          input_tokens: 1050,
          output_tokens: 190,
        }),
      ],
    );
    expect(report.matches).toHaveLength(1);
    expect(report.matches[0].classification).toBe("exact");
    expect(report.matches[0].isMatched).toBe(true);
    expect(report.matches[0].canonicalModel).toBe("claude-3.5-sonnet");
    expect(report.summary.matchedSpendUsd).toBe(2);
    expect(report.summary.coveragePct).toBe(100);
    expect(report.matches[0].tokenRatio).not.toBeNull();
    expect(report.matches[0].tokenRatio!).toBeLessThanOrEqual(
      EXACT_TOKEN_RATIO,
    );
  });

  test("likely match when model/day align but tokens diverge", () => {
    const report = buildReconciliationReport(
      [
        provider({
          provider: "openai",
          day: "2026-08-02",
          model: "gpt-4o",
          input_tokens: 10_000,
          output_tokens: 0,
          cost_usd: 5,
        }),
      ],
      [
        agent({
          day: "2026-08-02",
          model: "openai/gpt-4o",
          input_tokens: 1000,
          output_tokens: 0,
        }),
      ],
    );
    expect(report.matches[0].classification).toBe("likely");
    expect(report.matches[0].ruleHit).toBe("model_day_only");
    expect(report.summary.matchedSpendUsd).toBe(5);
  });

  test("unmatched provider spend", () => {
    const report = buildReconciliationReport(
      [
        provider({
          provider: "xai",
          day: "2026-08-03",
          model: "grok-3",
          cost_usd: 3.25,
        }),
      ],
      [],
    );
    expect(report.matches[0].classification).toBe("unmatched_provider");
    expect(report.summary.unmatchedProviderSpendUsd).toBe(3.25);
    expect(report.summary.matchedSpendUsd).toBe(0);
    expect(report.summary.coveragePct).toBe(0);
  });

  test("unmatched agent = usage without billing", () => {
    const report = buildReconciliationReport(
      [],
      [
        agent({
          day: "2026-08-03",
          model: "claude-sonnet-4",
          input_tokens: 5000,
          output_tokens: 500,
        }),
      ],
    );
    expect(report.matches[0].classification).toBe("unmatched_agent");
    expect(report.summary.agentTokensWithoutBilling).toBe(5500);
    expect(report.summary.providerSpendUsd).toBe(0);
    expect(report.summary.coveragePct).toBeNull();
  });

  test("duplicate_risk when OpenRouter + direct share day/model", () => {
    const report = buildReconciliationReport(
      [
        provider({
          provider: "openrouter",
          day: "2026-08-04",
          model: "anthropic/claude-sonnet-4",
          cost_usd: 1,
          input_tokens: 1000,
          output_tokens: 100,
        }),
        provider({
          provider: "anthropic",
          day: "2026-08-04",
          model: "claude-sonnet-4",
          cost_usd: 1.2,
          input_tokens: 1000,
          output_tokens: 100,
        }),
      ],
      [
        agent({
          day: "2026-08-04",
          model: "claude-sonnet-4",
          input_tokens: 1000,
          output_tokens: 100,
        }),
      ],
      { byokTreatment: "flag_overlap" },
    );
    expect(report.matches[0].classification).toBe("duplicate_risk");
    expect(report.matches[0].ruleHit).toBe("byok_overlap");
    expect(report.summary.duplicateRiskSpendUsd).toBeCloseTo(2.2);
    expect(report.summary.matchedSpendUsd).toBe(0);
    expect(report.notes.some((n) => /BYOK/i.test(n))).toBe(true);
  });

  test("prefer_direct keeps direct match and flags openrouter as duplicate_risk", () => {
    const report = buildReconciliationReport(
      [
        provider({
          provider: "openrouter",
          day: "2026-08-04",
          model: "anthropic/claude-sonnet-4",
          cost_usd: 1,
          input_tokens: 1000,
          output_tokens: 100,
        }),
        provider({
          provider: "anthropic",
          day: "2026-08-04",
          model: "claude-sonnet-4",
          cost_usd: 1.2,
          input_tokens: 1000,
          output_tokens: 100,
        }),
      ],
      [
        agent({
          day: "2026-08-04",
          model: "claude-sonnet-4",
          input_tokens: 1000,
          output_tokens: 100,
        }),
      ],
      { byokTreatment: "prefer_direct" },
    );
    const classes = report.matches.map((m) => m.classification).sort();
    expect(classes).toContain("exact");
    expect(classes).toContain("duplicate_risk");
    expect(report.summary.matchedSpendUsd).toBeCloseTo(1.2);
    expect(report.summary.duplicateRiskSpendUsd).toBeCloseTo(1);
  });

  test("exclude_openrouter removes openrouter from provider side", () => {
    const report = buildReconciliationReport(
      [
        provider({
          provider: "openrouter",
          day: "2026-08-04",
          model: "gpt-4o",
          cost_usd: 9,
        }),
        provider({
          provider: "openai",
          day: "2026-08-04",
          model: "gpt-4o",
          cost_usd: 2,
          input_tokens: 100,
          output_tokens: 10,
        }),
      ],
      [
        agent({
          day: "2026-08-04",
          model: "gpt-4o",
          input_tokens: 100,
          output_tokens: 10,
        }),
      ],
      { byokTreatment: "exclude_openrouter" },
    );
    expect(report.summary.providerSpendUsd).toBe(2);
    expect(
      report.matches.every((m) => m.classification !== "duplicate_risk"),
    ).toBe(true);
    expect(report.matches[0].classification).toBe("exact");
  });

  test("ambiguous when two non-BYOK providers share the key", () => {
    // openai + xai both reporting same canonical model (rare but ambiguous)
    const report = buildReconciliationReport(
      [
        provider({
          provider: "openai",
          day: "2026-08-05",
          model: "shared-model",
          cost_usd: 1,
        }),
        provider({
          provider: "xai",
          day: "2026-08-05",
          model: "shared-model",
          cost_usd: 2,
        }),
      ],
      [
        agent({
          day: "2026-08-05",
          model: "shared-model",
          input_tokens: 1000,
          output_tokens: 200,
        }),
      ],
    );
    expect(report.matches[0].classification).toBe("ambiguous");
    expect(report.summary.ambiguousSpendUsd).toBe(3);
    expect(report.summary.matchedSpendUsd).toBe(0);
  });

  test("never sums agent log cost into provider spend", () => {
    const report = buildReconciliationReport(
      [
        provider({
          provider: "anthropic",
          day: "2026-08-01",
          model: "claude-sonnet-4",
          cost_usd: 4,
          input_tokens: 100,
          output_tokens: 10,
        }),
      ],
      [
        agent({
          day: "2026-08-01",
          model: "claude-sonnet-4",
          input_tokens: 100,
          output_tokens: 10,
          cost_usd: 99,
        }),
      ],
    );
    expect(report.summary.providerSpendUsd).toBe(4);
    expect(report.summary.agentLogCostUsd).toBe(99);
    expect(report.summary.hasAgentLogCost).toBe(true);
    // Not 4+99
    expect(report.summary.matchedSpendUsd).toBe(4);
  });

  test("idempotent: same inputs produce same coverage and classifications", () => {
    const providers = [
      provider({
        provider: "anthropic",
        day: "2026-08-01",
        model: "claude-sonnet-4",
        cost_usd: 1,
      }),
    ];
    const agents = [agent({ day: "2026-08-01", model: "claude-sonnet-4" })];
    const a = buildReconciliationReport(providers, agents);
    const b = buildReconciliationReport(providers, agents);
    expect(a.summary).toEqual(b.summary);
    expect(a.matches.map((m) => m.classification)).toEqual(
      b.matches.map((m) => m.classification),
    );
  });

  test("delayed data note when agent-only on recent days", () => {
    const now = new Date("2026-08-06T15:00:00.000Z");
    const report = buildReconciliationReport(
      [],
      [
        agent({
          day: "2026-08-06",
          model: "claude-sonnet-4",
          input_tokens: 100,
        }),
      ],
      { now },
    );
    expect(
      report.notes.some((n) => /delayed cost|no provider billing yet/i.test(n)),
    ).toBe(true);
  });

  test("drill-down evidence includes providers, agent sources, ruleHit", () => {
    const report = buildReconciliationReport(
      [
        provider({
          provider: "anthropic",
          day: "2026-08-01",
          model: "claude-sonnet-4-20250514",
          cost_usd: 1.1,
          input_tokens: 500,
          output_tokens: 50,
        }),
      ],
      [
        agent({
          day: "2026-08-01",
          model: "claude-sonnet-4",
          source_id: "claude-code",
          input_tokens: 500,
          output_tokens: 50,
        }),
      ],
    );
    const m = report.matches[0];
    expect(m.provider[0].provider).toBe("anthropic");
    expect(m.provider[0].costUsd).toBe(1.1);
    expect(m.agent?.sourceIds).toContain("claude-code");
    expect(m.ruleHit).toBe("exact_token_band");
    expect(m.confidence).toBe(1);
  });

  test("includeProviders limits which connectors participate", () => {
    const report = buildReconciliationReport(
      [
        provider({
          provider: "anthropic",
          day: "2026-08-01",
          model: "claude-sonnet-4",
          cost_usd: 1,
        }),
        provider({
          provider: "openai",
          day: "2026-08-01",
          model: "gpt-4o",
          cost_usd: 5,
        }),
      ],
      [],
      { includeProviders: ["anthropic"] },
    );
    expect(report.summary.providerSpendUsd).toBe(1);
    expect(report.options.includeProviders).toEqual(["anthropic"]);
  });
});
