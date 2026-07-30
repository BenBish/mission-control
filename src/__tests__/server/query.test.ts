import { describe, expect, test } from "bun:test";
import {
  MAX_QUERY_LIMIT,
  optionalQueryString,
  parseOptionalPositiveInt,
} from "../../server/query.js";

describe("optionalQueryString", () => {
  test("returns undefined for non-strings and blank strings", () => {
    expect(optionalQueryString(undefined)).toBeUndefined();
    expect(optionalQueryString(null)).toBeUndefined();
    expect(optionalQueryString(1)).toBeUndefined();
    expect(optionalQueryString("")).toBeUndefined();
    expect(optionalQueryString("   ")).toBeUndefined();
  });

  test("returns trimmed non-empty strings", () => {
    expect(optionalQueryString("grok")).toBe("grok");
    expect(optionalQueryString("  claude-code  ")).toBe("claude-code");
  });
});

describe("parseOptionalPositiveInt", () => {
  test("absent values yield undefined (caller default)", () => {
    expect(parseOptionalPositiveInt(undefined)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(parseOptionalPositiveInt(null)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(parseOptionalPositiveInt("")).toEqual({
      ok: true,
      value: undefined,
    });
    expect(parseOptionalPositiveInt("   ")).toEqual({
      ok: true,
      value: undefined,
    });
  });

  test("accepts positive integer strings and numbers", () => {
    expect(parseOptionalPositiveInt("5")).toEqual({ ok: true, value: 5 });
    expect(parseOptionalPositiveInt(" 12 ")).toEqual({ ok: true, value: 12 });
    expect(parseOptionalPositiveInt(50)).toEqual({ ok: true, value: 50 });
  });

  test("rejects non-finite, non-integer, non-positive, and multi-value", () => {
    for (const bad of [
      "notanumber",
      "1.5",
      "0",
      "-1",
      "NaN",
      "Infinity",
      "1e2",
      Number.NaN,
      ["1", "2"],
      { n: 1 },
    ]) {
      const result = parseOptionalPositiveInt(bad, "limit");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("limit");
      }
    }
  });

  test("clamps oversized positive integers to MAX_QUERY_LIMIT", () => {
    expect(parseOptionalPositiveInt(String(MAX_QUERY_LIMIT + 1))).toEqual({
      ok: true,
      value: MAX_QUERY_LIMIT,
    });
    expect(parseOptionalPositiveInt("1000000000")).toEqual({
      ok: true,
      value: MAX_QUERY_LIMIT,
    });
    expect(parseOptionalPositiveInt("50")).toEqual({ ok: true, value: 50 });
  });

  test("respects a custom max ceiling", () => {
    expect(parseOptionalPositiveInt("999", "limit", 100)).toEqual({
      ok: true,
      value: 100,
    });
  });
});
