import { describe, expect, test } from "bun:test";
import {
  DATASET_SCOPES,
  FILTERABLE_QUERY_KEYS,
  getRouteScope,
  isSourceSelectorEnabled,
  runtimeApiSourceId,
  scopePhrase,
} from "../../config/sourceScope.js";

describe("source scope contract", () => {
  test("documents filterable and account-wide datasets", () => {
    const modes = new Set(DATASET_SCOPES.map((d) => d.mode));
    expect(modes.has("filterable")).toBe(true);
    expect(modes.has("account-wide")).toBe(true);
    expect(DATASET_SCOPES.some((d) => d.id === "provider-billing")).toBe(true);
    expect(DATASET_SCOPES.some((d) => d.id === "failures")).toBe(true);
  });

  test("filterable query keys list the scoped React Query roots", () => {
    expect(FILTERABLE_QUERY_KEYS.sort()).toEqual(
      [
        "activities",
        "consumption",
        "failures",
        "generations",
        "jobs",
        "runtime",
        "sessions",
      ].sort(),
    );
  });

  test("filterable routes keep the source selector enabled", () => {
    for (const path of [
      "/",
      "/activities",
      "/activities/activity-1",
      "/sessions",
      "/failures",
      "/jobs",
      "/generations",
      "/runtime",
    ]) {
      expect(getRouteScope(path).mode).toBe("filterable");
      expect(isSourceSelectorEnabled(path)).toBe(true);
    }
  });

  test("consumption is mixed; settings is unscoped", () => {
    expect(getRouteScope("/consumption").mode).toBe("mixed");
    expect(isSourceSelectorEnabled("/consumption")).toBe(true);

    expect(getRouteScope("/settings").mode).toBe("unscoped");
    expect(isSourceSelectorEnabled("/settings")).toBe(false);
  });

  test("scopePhrase uses display name when available", () => {
    expect(scopePhrase(undefined)).toBe("across all sources");
    expect(scopePhrase("grok")).toBe("for grok");
    expect(scopePhrase("grok", [{ id: "grok", name: "Grok" }])).toBe(
      "for Grok",
    );
  });

  test("runtimeApiSourceId only scopes inference sources", () => {
    const sources = [
      { id: "hermes", kind: "inference" },
      { id: "grok", kind: "agentic" },
    ];
    expect(runtimeApiSourceId(undefined, sources)).toBeUndefined();
    expect(runtimeApiSourceId("hermes", sources)).toBe("hermes");
    expect(runtimeApiSourceId("grok", sources)).toBeUndefined();
    expect(runtimeApiSourceId("hermes", [])).toBe("hermes");
  });
});
