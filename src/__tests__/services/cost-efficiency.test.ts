import { describe, expect, test } from "bun:test";
import type { ProviderUsageRow } from "../../db/queries/provider-usage.js";
import type { AgentUsageFactRow } from "../../db/queries/agent-usage.js";
import {
  applyFailureWaste,
  buildFeeCategories,
  computeAgentEfficiency,
  computeProviderEfficiency,
  estimateCacheSavingsUsd,
  generateOptimizationRecommendations,
} from "../../services/cost-efficiency.js";

function usage(
  partial: Partial<ProviderUsageRow> &
    Pick<ProviderUsageRow, "provider" | "day" | "model" | "cost_usd">,
): ProviderUsageRow {
  return {
    input_tokens: 1000,
    output_tokens: 500,
    request_count: 2,
    updated_at: null,
    ...partial,
  };
}

function fact(
  partial: Partial<AgentUsageFactRow> &
    Pick<AgentUsageFactRow, "session_id" | "source_id">,
): AgentUsageFactRow {
  return {
    session_external_id: null,
    session_title: null,
    session_cwd: "/home/ben/Dev/mission-control",
    session_started_at: "2026-07-10T00:00:00Z",
    model: "claude-sonnet-4",
    actor_id: "agent",
    actor_type: "agent",
    input_tokens: 1000,
    output_tokens: 200,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    cost_usd: 1,
    request_count: 1,
    activity_count: 1,
    ...partial,
  };
}

describe("estimateCacheSavingsUsd", () => {
  test("returns null without cache reads or cost", () => {
    expect(
      estimateCacheSavingsUsd({
        costUsd: 1,
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
      }),
    ).toBeNull();
    expect(
      estimateCacheSavingsUsd({
        costUsd: null,
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 500,
      }),
    ).toBeNull();
  });

  test("estimates savings from cache-read volume", () => {
    // $1 cost on 1000 input tokens → $0.001/token; 500 cache reads * 0.9
    const savings = estimateCacheSavingsUsd({
      costUsd: 1,
      inputTokens: 1000,
      outputTokens: 100,
      cacheReadTokens: 500,
      discount: 0.9,
    });
    expect(savings).toBeCloseTo(0.45);
  });
});

describe("computeProviderEfficiency", () => {
  test("cost/request and cost/1M output by provider and model", () => {
    const slices = computeProviderEfficiency([
      usage({
        provider: "openrouter",
        day: "2026-07-01",
        model: "cheap",
        cost_usd: 1,
        request_count: 10,
        output_tokens: 1_000_000,
      }),
      usage({
        provider: "openrouter",
        day: "2026-07-02",
        model: "pricey",
        cost_usd: 10,
        request_count: 2,
        output_tokens: 100_000,
      }),
    ]);
    const overall = slices.find((s) => s.dimension === "overall")!;
    expect(overall.costUsd).toBeCloseTo(11);
    expect(overall.costPerRequest).toBeCloseTo(11 / 12);
    expect(overall.costClass).toBe("actual_provider");

    const pricey = slices.find((s) => s.key === "openrouter/pricey")!;
    expect(pricey.costPer1MOutputTokens).toBeCloseTo(100);
  });

  test("sparse zero usage yields null unit costs", () => {
    const slices = computeProviderEfficiency([]);
    const overall = slices.find((s) => s.dimension === "overall")!;
    expect(overall.costUsd).toBeNull();
    expect(overall.costPerRequest).toBeNull();
    expect(overall.costPer1MOutputTokens).toBeNull();
  });
});

describe("computeAgentEfficiency + failure waste", () => {
  test("project dimension when cwd yields project label", () => {
    const slices = computeAgentEfficiency([
      fact({ session_id: "s1", source_id: "claude-code", cost_usd: 2 }),
      fact({
        session_id: "s2",
        source_id: "claude-code",
        cost_usd: 3,
        session_cwd: "/home/ben/Dev/other-app",
      }),
    ]);
    const projects = slices.filter((s) => s.dimension === "project");
    expect(projects.length).toBeGreaterThanOrEqual(1);
    const overall = slices.find((s) => s.dimension === "overall")!;
    expect(overall.costPerSession).toBeCloseTo(2.5);
    // Without outcome attribution, successful session cost is null
    expect(overall.costPerSuccessfulSession).toBeNull();
    expect(overall.missingOutcomeAttributionPct).toBe(100);
  });

  test("missing outcome attribution quantified; failure waste applied", () => {
    let slices = computeAgentEfficiency([
      fact({ session_id: "s1", source_id: "codex", cost_usd: 4 }),
    ]);
    slices = applyFailureWaste(slices, 1.5, 3, 4);
    const overall = slices.find((s) => s.dimension === "overall")!;
    expect(overall.failureWasteUsd).toBe(1.5);
    expect(overall.successfulSessionCount).toBe(3);
    expect(overall.costPerSuccessfulSession).toBeCloseTo(4 / 3);
    // Outcomes known for costed sessions — missing attribution is 0 (not failure rate)
    expect(overall.missingOutcomeAttributionPct).toBe(0);
  });

  test("cache savings on agent facts with cache reads", () => {
    const slices = computeAgentEfficiency([
      fact({
        session_id: "s1",
        source_id: "claude-code",
        cost_usd: 2,
        input_tokens: 2000,
        cache_read_tokens: 1000,
      }),
    ]);
    const overall = slices.find((s) => s.dimension === "overall")!;
    expect(overall.cacheSavingsUsd).not.toBeNull();
    expect(overall.cacheSavingsUsd!).toBeGreaterThan(0);
  });
});

describe("fee categories and recommendations", () => {
  test("fee categories keep classes distinct", () => {
    const fees = buildFeeCategories({
      actualProviderSpendUsd: 50,
      agentAttributedCostUsd: 40,
      estimatedCacheSavingsUsd: 5,
      failureWasteUsd: 3,
    });
    expect(fees.actualProviderSpendUsd).toBe(50);
    expect(fees.agentAttributedCostUsd).toBe(40);
    expect(fees.estimatedCacheSavingsUsd).toBe(5);
    expect(fees.notes.some((n) => /Do not sum/i.test(n))).toBe(true);
  });

  test("recommendations include outliers and evidence", () => {
    const provider = computeProviderEfficiency([
      usage({
        provider: "openrouter",
        day: "2026-07-01",
        model: "cheap",
        cost_usd: 2,
        request_count: 10,
        output_tokens: 2_000_000,
      }),
      usage({
        provider: "openrouter",
        day: "2026-07-01",
        model: "expensive",
        cost_usd: 20,
        request_count: 2,
        output_tokens: 100_000,
      }),
    ]);
    const agent = applyFailureWaste(
      computeAgentEfficiency([
        fact({
          session_id: "s1",
          source_id: "claude-code",
          cost_usd: 5,
          input_tokens: 50_000,
          cache_read_tokens: 0,
        }),
      ]),
      2,
      1,
      2,
    );
    const recs = generateOptimizationRecommendations({
      providerEfficiency: provider,
      agentEfficiency: agent,
      anomalies: [
        {
          kind: "daily",
          day: "2026-07-10",
          provider: null,
          model: null,
          valueUsd: 12,
          baselineUsd: 3,
          ratio: 4,
        },
      ],
    });
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.every((r) => r.evidence != null)).toBe(true);
    expect(recs.every((r) => r.estimatedImpactUsd >= 0)).toBe(true);
    expect(recs.some((r) => r.kind === "expensive_outlier")).toBe(true);
    expect(recs.some((r) => r.kind === "failure_waste")).toBe(true);
  });
});
