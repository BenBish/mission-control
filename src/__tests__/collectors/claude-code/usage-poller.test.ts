import { describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import {
  mapClaudeUsageToQuotaEvents,
  normalizeResetsAt,
  readClaudeOAuthToken,
} from "../../../collectors/claude-code/usage-poller.js";

describe("mapClaudeUsageToQuotaEvents", () => {
  const now = "2026-08-10T12:00:00.000Z";

  test("happy path maps three windows", () => {
    const events = mapClaudeUsageToQuotaEvents(
      {
        five_hour: {
          utilization: 38,
          resets_at: "2026-08-10T17:00:00.000Z",
        },
        seven_day: {
          utilization: 12.5,
          resets_at: "2026-08-12T00:00:00.000Z",
        },
        seven_day_opus: {
          utilization: 90,
          resets_at: "2026-08-12T00:00:00.000Z",
        },
      },
      now,
    );
    expect(events).toHaveLength(3);
    const byLimit = Object.fromEntries(
      events.map((e) => [
        (e.payload as { limitId: string }).limitId,
        e.payload as {
          limitId: string;
          usedPercent: number;
          windowMinutes: number;
          resetsAt?: string;
          timestamp: string;
        },
      ]),
    );
    expect(byLimit["claude:5h"].usedPercent).toBe(38);
    expect(byLimit["claude:5h"].windowMinutes).toBe(300);
    expect(byLimit["claude:5h"].resetsAt).toBe("2026-08-10T17:00:00.000Z");
    expect(byLimit["claude:7d"].usedPercent).toBe(12.5);
    expect(byLimit["claude:7d"].windowMinutes).toBe(10080);
    expect(byLimit["claude:7d_opus"].usedPercent).toBe(90);
    expect(events.every((e) => e.kind === "quota_snapshot")).toBe(true);
    expect(events[0].naturalKey).toContain("claude-oauth-usage:claude:5h:");
  });

  test("missing opus window is omitted", () => {
    const events = mapClaudeUsageToQuotaEvents(
      {
        five_hour: { utilization: 10, resets_at: "2026-08-10T17:00:00.000Z" },
        seven_day: { utilization: 20, resets_at: "2026-08-12T00:00:00.000Z" },
        seven_day_opus: null,
      },
      now,
    );
    expect(events).toHaveLength(2);
    expect(
      events.map((e) => (e.payload as { limitId: string }).limitId).sort(),
    ).toEqual(["claude:5h", "claude:7d"]);
  });

  test("malformed payload returns empty array", () => {
    expect(mapClaudeUsageToQuotaEvents(null, now)).toEqual([]);
    expect(mapClaudeUsageToQuotaEvents(undefined, now)).toEqual([]);
    expect(mapClaudeUsageToQuotaEvents({ foo: 1 }, now)).toEqual([]);
    expect(mapClaudeUsageToQuotaEvents("nope", now)).toEqual([]);
  });

  test("clamps utilization to 0–100", () => {
    const events = mapClaudeUsageToQuotaEvents(
      {
        five_hour: { utilization: -5, resets_at: null },
        seven_day: { utilization: 150, resets_at: null },
      },
      now,
    );
    const byLimit = Object.fromEntries(
      events.map((e) => [
        (e.payload as { limitId: string }).limitId,
        (e.payload as { usedPercent: number }).usedPercent,
      ]),
    );
    expect(byLimit["claude:5h"]).toBe(0);
    expect(byLimit["claude:7d"]).toBe(100);
  });

  test("normalizes epoch-seconds resets_at to ISO", () => {
    const events = mapClaudeUsageToQuotaEvents(
      {
        five_hour: {
          utilization: 1,
          resets_at: 1786366800, // epoch seconds
        },
      },
      now,
    );
    expect(events).toHaveLength(1);
    const resetsAt = (events[0].payload as { resetsAt?: string }).resetsAt;
    expect(resetsAt).toBeTruthy();
    expect(resetsAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("normalizeResetsAt", () => {
  test("handles ISO, seconds, and ms", () => {
    expect(normalizeResetsAt("2026-08-10T17:00:00.000Z")).toBe(
      "2026-08-10T17:00:00.000Z",
    );
    const sec = normalizeResetsAt(1_700_000_000);
    expect(sec).toMatch(/^\d{4}-/);
    const ms = normalizeResetsAt(1_700_000_000_000);
    expect(ms).toMatch(/^\d{4}-/);
    expect(normalizeResetsAt(null)).toBeUndefined();
    expect(normalizeResetsAt("not-a-date")).toBeUndefined();
  });
});

describe("readClaudeOAuthToken", () => {
  test("returns null for missing file", () => {
    expect(
      readClaudeOAuthToken(path.join(os.tmpdir(), "no-such-claude-creds.json")),
    ).toBeNull();
  });

  test("reads accessToken and expiresAt", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-claude-creds-"));
    const credPath = path.join(dir, ".credentials.json");
    fs.writeFileSync(
      credPath,
      JSON.stringify({
        claudeAiOauth: {
          accessToken: "test-token-not-real",
          expiresAt: 1_800_000_000_000,
        },
      }),
    );
    const tok = readClaudeOAuthToken(credPath);
    expect(tok?.accessToken).toBe("test-token-not-real");
    expect(tok?.expiresAt).toBe(1_800_000_000_000);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("returns null for invalid JSON", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-claude-creds-"));
    const credPath = path.join(dir, ".credentials.json");
    fs.writeFileSync(credPath, "{not-json");
    expect(readClaudeOAuthToken(credPath)).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
