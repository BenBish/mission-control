import { describe, expect, test } from "bun:test";
import {
  classifyMateriality,
  normalizeModelIdentity,
  previousPeriodWindow,
  projectLabelFromCwd,
} from "../../lib/model-identity.js";

describe("normalizeModelIdentity", () => {
  test("maps null/empty to unknown", () => {
    expect(normalizeModelIdentity(null).canonical).toBe("unknown");
    expect(normalizeModelIdentity("").isUnknown).toBe(true);
  });

  test("detects synthetic aliases", () => {
    expect(normalizeModelIdentity("<synthetic>").isSynthetic).toBe(true);
    expect(normalizeModelIdentity("synthetic").canonical).toBe("synthetic");
  });

  test("collapses dated Claude aliases to one canonical key", () => {
    const a = normalizeModelIdentity("claude-3-5-sonnet-20241022");
    const b = normalizeModelIdentity("claude-3-5-sonnet-20240620");
    expect(a.canonical).toBe("claude-3.5-sonnet");
    expect(b.canonical).toBe("claude-3.5-sonnet");
    expect(a.raw).toBe("claude-3-5-sonnet-20241022");
    expect(b.raw).toBe("claude-3-5-sonnet-20240620");
  });

  test("strips openrouter provider prefixes", () => {
    const id = normalizeModelIdentity(
      "openrouter/anthropic/claude-sonnet-4-20250514",
    );
    expect(id.canonical).toBe("claude-sonnet-4");
    expect(id.isUnknown).toBe(false);
  });

  test("strips gpt date stamps", () => {
    expect(normalizeModelIdentity("gpt-4o-2024-08-06").canonical).toBe(
      "gpt-4o",
    );
  });
});

describe("projectLabelFromCwd", () => {
  test("returns basename only (never full path)", () => {
    expect(projectLabelFromCwd("/home/ben/Dev/mission-control")).toBe(
      "mission-control",
    );
    expect(projectLabelFromCwd("C:\\Users\\ben\\proj")).toBe("proj");
  });

  test("null/empty → null", () => {
    expect(projectLabelFromCwd(null)).toBeNull();
    expect(projectLabelFromCwd("")).toBeNull();
  });
});

describe("classifyMateriality", () => {
  test("synthetic and zero", () => {
    expect(
      classifyMateriality({
        inputTokens: 10,
        outputTokens: 0,
        isSynthetic: true,
      }),
    ).toBe("synthetic");
    expect(
      classifyMateriality({
        inputTokens: 0,
        outputTokens: 0,
        isSynthetic: false,
      }),
    ).toBe("zero");
    expect(
      classifyMateriality({
        inputTokens: 1,
        outputTokens: 0,
        isSynthetic: false,
      }),
    ).toBe("material");
  });
});

describe("previousPeriodWindow", () => {
  test("same duration ending before since", () => {
    const since = "2026-08-01T00:00:00.000Z";
    const until = "2026-08-08T00:00:00.000Z";
    const prev = previousPeriodWindow(since, until);
    expect(Date.parse(prev.until)).toBe(Date.parse(since) - 1);
    expect(Date.parse(prev.until) - Date.parse(prev.since)).toBe(
      Date.parse(until) - Date.parse(since),
    );
  });

  test("rejects invalid range", () => {
    expect(() =>
      previousPeriodWindow(
        "2026-08-08T00:00:00.000Z",
        "2026-08-01T00:00:00.000Z",
      ),
    ).toThrow();
  });
});
