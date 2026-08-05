/**
 * Date-range semantics for agent ISO timestamps vs provider UTC day keys (BSH-97).
 */
import { describe, test, expect } from "bun:test";
import {
  getAgentUsageSince,
  getProviderUsageSinceDay,
  toProviderDayKey,
  utcDayKey,
} from "../../lib/date-range.js";
import { startOfLocalDayIso } from "../../lib/direct-api-spend.js";

describe("utcDayKey", () => {
  test("formats UTC calendar day", () => {
    expect(utcDayKey(new Date("2026-08-05T12:00:00.000Z"))).toBe("2026-08-05");
    expect(utcDayKey(new Date("2026-08-05T00:00:00.000Z"))).toBe("2026-08-05");
    expect(utcDayKey(new Date("2026-08-05T23:59:59.999Z"))).toBe("2026-08-05");
  });

  test("positive offset afternoon is still the UTC day of the instant", () => {
    // 13:00 BST = 12:00 UTC on 2026-08-05
    expect(utcDayKey(new Date("2026-08-05T12:00:00.000Z"))).toBe("2026-08-05");
  });

  test("negative offset late evening stays on its UTC day", () => {
    // 20:00 PDT = 03:00 UTC next day
    expect(utcDayKey(new Date("2026-08-06T03:00:00.000Z"))).toBe("2026-08-06");
  });
});

describe("toProviderDayKey", () => {
  test("passes pure day keys through", () => {
    expect(toProviderDayKey("2026-08-05")).toBe("2026-08-05");
  });

  test("ISO datetime → UTC day of the instant", () => {
    expect(toProviderDayKey("2026-08-05T12:00:00.000Z")).toBe("2026-08-05");
    expect(toProviderDayKey("2026-08-04T23:00:00.000Z")).toBe("2026-08-04");
  });

  test("ISO with positive offset uses the instant's UTC day", () => {
    // Local London midnight Aug 5 BST = Aug 4 23:00Z — UTC day is still Aug 4.
    // Clients must send day keys for "today"; this documents ISO behaviour.
    expect(toProviderDayKey("2026-08-04T23:00:00.000Z")).toBe("2026-08-04");
    expect(toProviderDayKey("2026-08-05T00:00:00+01:00")).toBe("2026-08-04");
  });
});

describe("getProviderUsageSinceDay", () => {
  test("all → undefined", () => {
    expect(getProviderUsageSinceDay("all")).toBeUndefined();
  });

  test("today is the UTC calendar day (not local-midnight slice)", () => {
    // Reproduce BSH-97: Europe/London-style afternoon on 2026-08-05.
    const now = new Date("2026-08-05T12:13:00.000Z"); // ~13:13 BST
    expect(getProviderUsageSinceDay("today", now)).toBe("2026-08-05");

    // The buggy path: local midnight ISO truncated — wrong for +offsets.
    // We assert the fixed helper does not match that prior-day key when
    // the system local midnight would serialize before UTC midnight.
    const buggySlice = startOfLocalDayIso(now.getTime()).slice(0, 10);
    // On machines in positive offsets, buggySlice may be 2026-08-04.
    // The fixed value must always be UTC today regardless.
    expect(getProviderUsageSinceDay("today", now)).toBe("2026-08-05");
    if (buggySlice !== "2026-08-05") {
      expect(getProviderUsageSinceDay("today", now)).not.toBe(buggySlice);
    }
  });

  test("today near UTC day boundary", () => {
    expect(
      getProviderUsageSinceDay("today", new Date("2026-08-05T00:00:00.000Z")),
    ).toBe("2026-08-05");
    expect(
      getProviderUsageSinceDay("today", new Date("2026-08-05T23:59:59.000Z")),
    ).toBe("2026-08-05");
  });

  test("positive UTC offset wall-clock still maps via UTC day", () => {
    // Instant corresponding to 2026-08-05 01:00 in UTC+2 (CEST)
    const now = new Date("2026-08-04T23:00:00.000Z");
    // UTC day is Aug 4 — provider "today" is Aug 4, not Aug 5 local.
    expect(getProviderUsageSinceDay("today", now)).toBe("2026-08-04");
  });

  test("negative UTC offset wall-clock maps via UTC day", () => {
    // 2026-08-05 20:00 America/Los_Angeles (UTC-7) = 2026-08-06T03:00Z
    const now = new Date("2026-08-06T03:00:00.000Z");
    expect(getProviderUsageSinceDay("today", now)).toBe("2026-08-06");
  });

  test("DST spring-forward UTC day is stable", () => {
    // EU DST 2026-03-29 01:00 UTC; US DST already sprung forward.
    const now = new Date("2026-03-29T01:30:00.000Z");
    expect(getProviderUsageSinceDay("today", now)).toBe("2026-03-29");
  });

  test("DST fall-back UTC day is stable", () => {
    // EU DST ends 2026-10-25; 01:30 UTC is unambiguous as a UTC day.
    const now = new Date("2026-10-25T01:30:00.000Z");
    expect(getProviderUsageSinceDay("today", now)).toBe("2026-10-25");
  });

  test("7d / 30d use UTC day of (now − N×24h)", () => {
    const now = new Date("2026-08-05T12:00:00.000Z");
    expect(getProviderUsageSinceDay("7d", now)).toBe("2026-07-29");
    expect(getProviderUsageSinceDay("30d", now)).toBe("2026-07-06");
  });
});

describe("getAgentUsageSince", () => {
  test("all → undefined", () => {
    expect(getAgentUsageSince("all")).toBeUndefined();
  });

  test("today is start of local calendar day as ISO", () => {
    const now = new Date(2026, 7, 5, 13, 13, 0); // Aug 5 13:13 local
    const since = getAgentUsageSince("today", now);
    expect(since).toBeDefined();
    const d = new Date(since!);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getSeconds()).toBe(0);
    expect(d.getDate()).toBe(5);
    expect(d.getMonth()).toBe(7);
  });

  test("7d / 30d are absolute rolling windows", () => {
    const now = new Date("2026-08-05T12:00:00.000Z");
    expect(getAgentUsageSince("7d", now)).toBe(
      new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    );
    expect(getAgentUsageSince("30d", now)).toBe(
      new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    );
  });

  test("agent today and provider today are independently typed", () => {
    const now = new Date("2026-08-05T12:00:00.000Z");
    const agent = getAgentUsageSince("today", now);
    const provider = getProviderUsageSinceDay("today", now);
    // Agent is ISO datetime; provider is YYYY-MM-DD day key.
    expect(agent).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(provider).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(provider).toBe("2026-08-05");
  });
});
