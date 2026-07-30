import { describe, expect, test } from "bun:test";
import { optionalQueryString } from "../../server/query.js";

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
