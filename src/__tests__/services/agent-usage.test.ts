import { describe, expect, test } from "bun:test";
import type { AgentUsageFactRow } from "../../db/queries/agent-usage.js";
import {
  buildAgentUsageSessionsForDriver,
  buildAgentUsageSummary,
} from "../../services/agent-usage.js";

function fact(partial: Partial<AgentUsageFactRow>): AgentUsageFactRow {
  return {
    source_id: "claude-code",
    session_id: "sess-1",
    session_external_id: "ext-1",
    session_title: "Session one",
    session_cwd: "/home/ben/Dev/mission-control",
    session_started_at: "2026-08-05T10:00:00.000Z",
    model: "claude-3-5-sonnet-20241022",
    actor_id: "agent-main",
    actor_type: "agent",
    input_tokens: 1000,
    output_tokens: 200,
    cache_read_tokens: 50,
    cache_write_tokens: 10,
    cost_usd: null,
    request_count: 2,
    activity_count: 5,
    ...partial,
  };
}

describe("buildAgentUsageSummary", () => {
  test("aggregates model aliases to canonical and keeps raw", () => {
    const summary = buildAgentUsageSummary([
      fact({ model: "claude-3-5-sonnet-20241022", input_tokens: 1000 }),
      fact({
        model: "claude-3-5-sonnet-20240620",
        session_id: "sess-2",
        input_tokens: 500,
        output_tokens: 100,
      }),
    ]);
    expect(summary.drivers).toHaveLength(1);
    expect(summary.drivers[0].canonicalModel).toBe("claude-3.5-sonnet");
    expect(summary.drivers[0].rawModels).toEqual([
      "claude-3-5-sonnet-20240620",
      "claude-3-5-sonnet-20241022",
    ]);
    expect(summary.drivers[0].inputTokens).toBe(1500);
    expect(summary.drivers[0].sessionCount).toBe(2);
    expect(summary.drivers[0].project).toBe("mission-control");
  });

  test("excludes zero and synthetic from default ranking", () => {
    const summary = buildAgentUsageSummary([
      fact({ model: "claude-sonnet-4", input_tokens: 100, output_tokens: 0 }),
      fact({
        model: "<synthetic>",
        session_id: "s2",
        input_tokens: 999,
        output_tokens: 1,
      }),
      fact({
        model: "gpt-4o",
        session_id: "s3",
        input_tokens: 0,
        output_tokens: 0,
      }),
      fact({
        model: "unknown",
        session_id: "s4",
        input_tokens: 5000,
        output_tokens: 0,
      }),
    ]);
    expect(summary.drivers.map((d) => d.canonicalModel)).toEqual([
      "claude-sonnet-4",
    ]);
    expect(summary.coverage.syntheticTokens).toBe(1000);
    expect(summary.coverage.zeroTokenFactCount).toBe(1);
    expect(summary.coverage.unknownModelTokens).toBe(5000);
    expect(summary.coverage.unattributedTokens).toBe(6000);
    expect(summary.coverage.unattributedPct).toBeGreaterThan(0);
  });

  test("includeNonMaterial surfaces synthetic/zero/unknown", () => {
    const summary = buildAgentUsageSummary(
      [
        fact({ model: "<synthetic>", input_tokens: 10, output_tokens: 0 }),
        fact({
          model: "unknown",
          session_id: "s2",
          input_tokens: 20,
          output_tokens: 0,
        }),
      ],
      { includeNonMaterial: true },
    );
    expect(summary.drivers.length).toBeGreaterThanOrEqual(1);
  });

  test("project dimension uses basename not full path", () => {
    const summary = buildAgentUsageSummary(
      [fact({ session_cwd: "/Users/ben/work/my-app" })],
      { dimension: "project" },
    );
    expect(summary.drivers[0].project).toBe("my-app");
    expect(summary.drivers[0].key).toContain("my-app");
    expect(JSON.stringify(summary.drivers)).not.toContain("/Users/ben");
  });

  test("missing partial dimensions still produce drivers", () => {
    const summary = buildAgentUsageSummary([
      fact({
        model: "gpt-4o",
        session_cwd: null,
        actor_id: "unknown",
      }),
    ]);
    expect(summary.drivers).toHaveLength(1);
    expect(summary.coverage.missingProjectTokens).toBe(1200);
  });
});

describe("buildAgentUsageSessionsForDriver", () => {
  test("returns sessions for a model driver key", () => {
    const facts = [
      fact({ session_id: "s1", model: "gpt-4o-2024-08-06" }),
      fact({
        session_id: "s2",
        model: "gpt-4o",
        input_tokens: 50,
        output_tokens: 10,
      }),
      fact({
        session_id: "s3",
        model: "claude-sonnet-4",
        input_tokens: 999,
      }),
    ];
    const summary = buildAgentUsageSummary(facts);
    const key = summary.drivers.find((d) => d.canonicalModel === "gpt-4o")!.key;
    const sessions = buildAgentUsageSessionsForDriver(facts, {
      dimension: "model",
      driverKey: key,
    });
    expect(sessions.map((s) => s.sessionId).sort()).toEqual(["s1", "s2"]);
    expect(sessions.every((s) => s.project === "mission-control")).toBe(true);
  });
});
