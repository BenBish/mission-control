/**
 * Tests for date-utils — date parsing, formatting, and comparison utilities.
 * Covers the fix for ORC-33: Invalid Date in agent status display.
 */
import { describe, test, expect } from "bun:test";
import { parseDate, formatLastActive, compareDates } from "../../lib/date-utils.js";

describe("parseDate", () => {
  test("returns null for null", () => {
    expect(parseDate(null)).toBeNull();
  });

  test("returns null for undefined", () => {
    expect(parseDate(undefined)).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(parseDate("")).toBeNull();
  });

  test("returns null for invalid date string", () => {
    expect(parseDate("not-a-date")).toBeNull();
  });

  test("parses ISO-8601 string", () => {
    const date = parseDate("2026-02-23T12:00:00.000Z");
    expect(date).toBeInstanceOf(Date);
    expect(date!.toISOString()).toBe("2026-02-23T12:00:00.000Z");
  });

  test("parses date-only string", () => {
    const date = parseDate("2026-02-23");
    expect(date).toBeInstanceOf(Date);
    expect(date!.getFullYear()).toBe(2026);
  });
});

describe("formatLastActive", () => {
  test('returns "Never" for null', () => {
    expect(formatLastActive(null)).toBe("Never");
  });

  test('returns "Never" for undefined', () => {
    expect(formatLastActive(undefined)).toBe("Never");
  });

  test('returns "Never" for empty string', () => {
    expect(formatLastActive("")).toBe("Never");
  });

  test('returns "Never" for invalid date', () => {
    expect(formatLastActive("garbage")).toBe("Never");
  });

  test('returns "Just now" for timestamp within the last minute', () => {
    const thirtySecsAgo = new Date(Date.now() - 30_000).toISOString();
    expect(formatLastActive(thirtySecsAgo)).toBe("Just now");
  });

  test('returns "Just now" for future timestamp (clock skew)', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(formatLastActive(future)).toBe("Just now");
  });

  test("returns minutes ago for recent timestamps", () => {
    const fiveMinsAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(formatLastActive(fiveMinsAgo)).toBe("5m ago");
  });

  test("returns hours ago for timestamps within a day", () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 3600_000).toISOString();
    expect(formatLastActive(threeHoursAgo)).toBe("3h ago");
  });

  test("returns days ago for timestamps within a week", () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 86400_000).toISOString();
    expect(formatLastActive(twoDaysAgo)).toBe("2d ago");
  });

  test("returns formatted date for timestamps older than a week", () => {
    const twoWeeksAgo = new Date(Date.now() - 14 * 86400_000).toISOString();
    const result = formatLastActive(twoWeeksAgo);
    // Should be a locale date string, not "Invalid Date"
    expect(result).not.toBe("Invalid Date");
    expect(result).not.toBe("Never");
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("compareDates", () => {
  test("sorts null/empty values to the bottom (epoch 0)", () => {
    expect(compareDates("", "2026-02-23T12:00:00Z")).toBeLessThan(0);
    expect(compareDates(null, "2026-02-23T12:00:00Z")).toBeLessThan(0);
    expect(compareDates(undefined, "2026-02-23T12:00:00Z")).toBeLessThan(0);
  });

  test("treats two null/empty values as equal", () => {
    expect(compareDates("", "")).toBe(0);
    expect(compareDates(null, undefined)).toBe(0);
  });

  test("orders valid dates chronologically", () => {
    const earlier = "2026-02-22T12:00:00Z";
    const later = "2026-02-23T12:00:00Z";
    expect(compareDates(earlier, later)).toBeLessThan(0);
    expect(compareDates(later, earlier)).toBeGreaterThan(0);
  });

  test("treats identical dates as equal", () => {
    const ts = "2026-02-23T12:00:00Z";
    expect(compareDates(ts, ts)).toBe(0);
  });
});
