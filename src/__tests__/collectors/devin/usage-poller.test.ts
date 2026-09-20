import { describe, expect, test } from "bun:test";
import {
  devinUserStatusUrl,
  mapDevinPlanToQuotaEvents,
  pollDevinUsageEvents,
} from "../../../collectors/devin/usage-poller.js";

const now = new Date("2026-09-20T12:00:00.000Z");

const planPayload = {
  planStatus: {
    acuConsumed: 120,
    acuLimit: 500,
    dailyQuotaRemainingPercent: 40,
    weeklyQuotaRemainingPercent: 70,
    dailyQuotaResetAtUnix: 1_789_660_800,
    weeklyQuotaResetAtUnix: 1_790_006_400,
  },
};

describe("devinUserStatusUrl", () => {
  test("targets the SeatManagementService GetUserStatus RPC", () => {
    expect(devinUserStatusUrl("https://server.example.com/")).toBe(
      "https://server.example.com/exa.seat_management_pb.SeatManagementService/GetUserStatus",
    );
  });
});

describe("mapDevinPlanToQuotaEvents", () => {
  test("maps daily, weekly, and ACU windows", () => {
    const events = mapDevinPlanToQuotaEvents(planPayload, now);
    expect(events).toHaveLength(3);

    const byLimit = new Map(
      events.map((e) => [
        (e.payload as { limitId: string }).limitId,
        e.payload as {
          usedPercent: number;
          windowMinutes?: number;
          resetsAt?: string;
        },
      ]),
    );

    // remaining → used inversion
    expect(byLimit.get("devin:daily")?.usedPercent).toBe(60);
    expect(byLimit.get("devin:daily")?.windowMinutes).toBe(1_440);
    expect(byLimit.get("devin:daily")?.resetsAt).toBe(
      new Date(1_789_660_800 * 1000).toISOString(),
    );

    expect(byLimit.get("devin:weekly")?.usedPercent).toBe(30);
    expect(byLimit.get("devin:weekly")?.windowMinutes).toBe(10_080);

    // 120/500 = 24%
    expect(byLimit.get("devin:acu")?.usedPercent).toBe(24);

    for (const e of events) {
      expect(e.kind).toBe("quota_snapshot");
      expect(e.naturalKey).toContain("devin-plan:");
    }
  });

  test("accepts snake_case fields and nested userStatus", () => {
    const events = mapDevinPlanToQuotaEvents(
      {
        userStatus: {
          planStatus: {
            acu_consumed: "10",
            acu_limit: "100",
            daily_quota_remaining_percent: 100,
          },
        },
      },
      now,
    );
    const limits = events.map(
      (e) => (e.payload as { limitId: string }).limitId,
    );
    expect(limits).toContain("devin:daily");
    expect(limits).toContain("devin:acu");
  });

  test("returns [] on unrecognized payloads — never invents numbers", () => {
    expect(mapDevinPlanToQuotaEvents(null, now)).toEqual([]);
    expect(mapDevinPlanToQuotaEvents({}, now)).toEqual([]);
    expect(
      mapDevinPlanToQuotaEvents({ planStatus: { tier: "pro" } }, now),
    ).toEqual([]);
  });

  test("clamps out-of-range percentages", () => {
    const events = mapDevinPlanToQuotaEvents(
      { planStatus: { dailyQuotaRemainingPercent: -20 } },
      now,
    );
    expect((events[0].payload as { usedPercent: number }).usedPercent).toBe(
      100,
    );
  });
});

describe("pollDevinUsageEvents", () => {
  test("returns [] when no credentials resolve", async () => {
    const events = await pollDevinUsageEvents({
      credentialsPath: "/nonexistent/credentials.toml",
      now,
      onWarn: () => {},
    });
    expect(events).toEqual([]);
  });

  test("soft-fails on unauthorized and on unparseable payloads", async () => {
    const warns: string[] = [];
    const unauthorized = await pollDevinUsageEvents({
      credentialsPath: "/nonexistent/credentials.toml",
      fetchImpl: async () => new Response("denied", { status: 403 }),
      now,
      onWarn: (m) => warns.push(m),
    });
    expect(unauthorized).toEqual([]);

    // With an env-override credential the fetch runs but the endpoint
    // contract may drift — still must not throw.
    process.env.MC_DEVIN_API_KEY = "test-key-not-real";
    try {
      const drift = await pollDevinUsageEvents({
        fetchImpl: async () =>
          new Response(JSON.stringify({ unexpected: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        now,
        onWarn: (m) => warns.push(m),
      });
      expect(drift).toEqual([]);
      expect(warns.length).toBeGreaterThan(0);
    } finally {
      delete process.env.MC_DEVIN_API_KEY;
    }
  });

  test("maps a successful GetUserStatus response", async () => {
    process.env.MC_DEVIN_API_KEY = "test-key-not-real";
    try {
      const events = await pollDevinUsageEvents({
        fetchImpl: async () =>
          new Response(JSON.stringify(planPayload), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        now,
        onWarn: () => {},
      });
      expect(events).toHaveLength(3);
      expect(events.every((e) => e.kind === "quota_snapshot")).toBe(true);
    } finally {
      delete process.env.MC_DEVIN_API_KEY;
    }
  });

  test("sends the metadata envelope the Connect-RPC endpoint requires", async () => {
    process.env.MC_DEVIN_API_KEY = "test-key-not-real";
    let capturedBody: unknown;
    try {
      await pollDevinUsageEvents({
        fetchImpl: async (_url, init) => {
          capturedBody = JSON.parse(String(init?.body));
          return new Response(JSON.stringify(planPayload), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        },
        now,
        onWarn: () => {},
      });
      // The server 400s on a bare {} — metadata with api_key, request_id
      // (uint64), ide_name, ide_version, extension_version is required.
      const meta = (capturedBody as { metadata?: Record<string, unknown> })
        .metadata;
      expect(meta?.api_key).toBe("test-key-not-real");
      expect(String(meta?.request_id)).toMatch(/^\d+$/);
      for (const field of ["ide_name", "ide_version", "extension_version"]) {
        expect(typeof meta?.[field]).toBe("string");
        expect(String(meta?.[field]).length).toBeGreaterThan(0);
      }
    } finally {
      delete process.env.MC_DEVIN_API_KEY;
    }
  });
});
