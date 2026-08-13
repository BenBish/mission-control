import { describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import {
  grokBillingUrl,
  mapGrokBillingToQuotaEvents,
  normalizeResetsAt,
  readGrokAuthToken,
  windowFromPeriod,
} from "../../../collectors/grok/usage-poller.js";

const weeklyPayload = {
  config: {
    currentPeriod: {
      type: "USAGE_PERIOD_TYPE_WEEKLY",
      start: "2026-08-10T02:53:15.569935+00:00",
      end: "2026-08-17T02:53:15.569935+00:00",
    },
    creditUsagePercent: 53,
    productUsage: [{ product: "GrokBuild", usagePercent: 53 }],
    prepaidBalance: { val: 12 },
    onDemandUsed: { val: 0 },
    billingPeriodStart: "2026-08-10T02:53:15.569935+00:00",
    billingPeriodEnd: "2026-08-17T02:53:15.569935+00:00",
  },
};

describe("mapGrokBillingToQuotaEvents", () => {
  const now = "2026-08-13T12:00:00.000Z";

  test("maps weekly SuperGrok window and skips duplicate product bar", () => {
    const events = mapGrokBillingToQuotaEvents(weeklyPayload, now);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("quota_snapshot");
    expect(events[0].payload).toMatchObject({
      timestamp: now,
      limitId: "grok:week",
      usedPercent: 53,
      windowMinutes: 10_080,
    });
    const resetsAt = (events[0].payload as { resetsAt?: string }).resetsAt;
    expect(resetsAt).toBe("2026-08-17T02:53:15.569Z");
    expect(events[0].naturalKey).toContain("grok-billing:grok:week:");
  });

  test("emits extra product windows when they differ from the period bar", () => {
    const events = mapGrokBillingToQuotaEvents(
      {
        config: {
          currentPeriod: {
            type: "USAGE_PERIOD_TYPE_WEEKLY",
            start: "2026-08-10T00:00:00.000Z",
            end: "2026-08-17T00:00:00.000Z",
          },
          creditUsagePercent: 40,
          productUsage: [
            { product: "GrokBuild", usagePercent: 40 },
            { product: "Imagine", usagePercent: 90 },
          ],
        },
      },
      now,
    );
    const byLimit = Object.fromEntries(
      events.map((e) => [
        (e.payload as { limitId: string }).limitId,
        (e.payload as { usedPercent: number }).usedPercent,
      ]),
    );
    expect(byLimit["grok:week"]).toBe(40);
    expect(byLimit["grok:imagine"]).toBe(90);
    expect(byLimit["grok:grokbuild"]).toBe(40);
    expect(events.every((e) => e.kind === "quota_snapshot")).toBe(true);
  });

  test("does not emit wallet fields as quota", () => {
    const events = mapGrokBillingToQuotaEvents(weeklyPayload, now);
    const blob = JSON.stringify(events);
    expect(blob).not.toContain("prepaidBalance");
    expect(blob).not.toContain("onDemand");
  });

  test("malformed payload returns empty array", () => {
    expect(mapGrokBillingToQuotaEvents(null, now)).toEqual([]);
    expect(mapGrokBillingToQuotaEvents(undefined, now)).toEqual([]);
    expect(mapGrokBillingToQuotaEvents({ foo: 1 }, now)).toEqual([]);
    expect(mapGrokBillingToQuotaEvents("nope", now)).toEqual([]);
    expect(
      mapGrokBillingToQuotaEvents(
        { config: { prepaidBalance: { val: 9 } } },
        now,
      ),
    ).toEqual([]);
  });

  test("clamps utilization to 0–100", () => {
    const events = mapGrokBillingToQuotaEvents(
      {
        config: {
          currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY" },
          creditUsagePercent: 150,
        },
      },
      now,
    );
    expect((events[0].payload as { usedPercent: number }).usedPercent).toBe(
      100,
    );
  });

  test("accepts unwrapped root payloads", () => {
    const events = mapGrokBillingToQuotaEvents(
      {
        currentPeriod: { type: "USAGE_PERIOD_TYPE_MONTHLY" },
        creditUsagePercent: 10,
      },
      now,
    );
    expect(events).toHaveLength(1);
    expect((events[0].payload as { limitId: string }).limitId).toBe(
      "grok:month",
    );
  });
});

describe("windowFromPeriod", () => {
  test("classifies weekly / monthly / 5h / unknown", () => {
    expect(windowFromPeriod("USAGE_PERIOD_TYPE_WEEKLY", null, null)).toEqual({
      limitId: "grok:week",
      windowMinutes: 10_080,
    });
    expect(windowFromPeriod("USAGE_PERIOD_TYPE_MONTHLY", null, null)).toEqual({
      limitId: "grok:month",
      windowMinutes: 43_200,
    });
    expect(
      windowFromPeriod(
        "USAGE_PERIOD_TYPE_FIVE_HOUR",
        "2026-08-13T00:00:00.000Z",
        "2026-08-13T05:00:00.000Z",
      ),
    ).toEqual({ limitId: "grok:5h", windowMinutes: 300 });
    expect(windowFromPeriod("mystery", null, null)).toEqual({
      limitId: "grok:plan",
    });
  });
});

describe("normalizeResetsAt", () => {
  test("handles ISO, seconds, and ms", () => {
    expect(normalizeResetsAt("2026-08-17T02:53:15.569935+00:00")).toBe(
      "2026-08-17T02:53:15.569Z",
    );
    const sec = normalizeResetsAt(1_700_000_000);
    expect(sec).toMatch(/^\d{4}-/);
    expect(normalizeResetsAt(null)).toBeUndefined();
    expect(normalizeResetsAt("not-a-date")).toBeUndefined();
  });
});

describe("readGrokAuthToken", () => {
  test("returns null for missing file", () => {
    expect(
      readGrokAuthToken(path.join(os.tmpdir(), "no-such-grok-auth.json")),
    ).toBeNull();
  });

  test("reads OIDC key and ISO expires_at", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-grok-auth-"));
    const authPath = path.join(dir, "auth.json");
    fs.writeFileSync(
      authPath,
      JSON.stringify({
        "https://auth.x.ai::example": {
          key: "test-token-not-real",
          auth_mode: "oidc",
          expires_at: "2026-08-13T20:41:48.516Z",
        },
      }),
    );
    const tok = readGrokAuthToken(authPath);
    expect(tok?.accessToken).toBe("test-token-not-real");
    expect(tok?.expiresAt).toBe(Date.parse("2026-08-13T20:41:48.516Z"));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("returns null for invalid JSON", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-grok-auth-"));
    const authPath = path.join(dir, "auth.json");
    fs.writeFileSync(authPath, "{not-json");
    expect(readGrokAuthToken(authPath)).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("grokBillingUrl", () => {
  test("appends billing path and strips trailing slash", () => {
    expect(grokBillingUrl("https://cli-chat-proxy.grok.com/v1")).toBe(
      "https://cli-chat-proxy.grok.com/v1/billing?format=credits",
    );
    expect(grokBillingUrl("https://example.test/v1/")).toBe(
      "https://example.test/v1/billing?format=credits",
    );
  });
});
