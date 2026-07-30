/**
 * Unit tests for Dashboard Direct API Spend helpers (BSH-69).
 */
import { describe, test, expect } from "bun:test";
import {
  aggregateProviderCost,
  summarizeProviderSync,
  formatDirectApiSpendPrimary,
  formatDirectApiSpend30d,
  directApiSpendSyncStatusKind,
  startOfLocalDayIso,
  daysAgoIso,
  PROVIDER_SYNC_STALE_MS,
} from "../../lib/direct-api-spend.js";

describe("aggregateProviderCost", () => {
  test("empty / null rows → zero without cost", () => {
    expect(aggregateProviderCost(undefined)).toEqual({
      cost: 0,
      hasCost: false,
    });
    expect(aggregateProviderCost([])).toEqual({ cost: 0, hasCost: false });
  });

  test("sums non-null costs and tracks hasCost", () => {
    const result = aggregateProviderCost([
      { cost_usd: 1.1 },
      { cost_usd: null },
      { cost_usd: 2.0 },
    ]);
    expect(result.hasCost).toBe(true);
    expect(result.cost).toBeCloseTo(3.1, 5);
  });

  test("all-null costs → hasCost false", () => {
    expect(
      aggregateProviderCost([{ cost_usd: null }, { cost_usd: null }]),
    ).toEqual({ cost: 0, hasCost: false });
  });
});

describe("summarizeProviderSync", () => {
  const now = Date.parse("2026-07-30T12:00:00.000Z");

  test("ignores unconfigured providers", () => {
    const health = summarizeProviderSync(
      [
        {
          configured: false,
          status: "error",
          lastSuccessAt: "2026-07-30T11:00:00.000Z",
          lastError: "should ignore",
        },
      ],
      now,
    );
    expect(health.anyConfigured).toBe(false);
    expect(health.hasError).toBe(false);
    expect(health.hasSuccessfulSync).toBe(false);
    expect(health.lastSuccessAt).toBeNull();
  });

  test("picks latest lastSuccessAt among configured", () => {
    const health = summarizeProviderSync(
      [
        {
          configured: true,
          status: "ok",
          lastSuccessAt: "2026-07-30T08:00:00.000Z",
          lastError: null,
        },
        {
          configured: true,
          status: "ok",
          lastSuccessAt: "2026-07-30T10:00:00.000Z",
          lastError: null,
        },
      ],
      now,
    );
    expect(health.lastSuccessAt).toBe("2026-07-30T10:00:00.000Z");
    expect(health.hasSuccessfulSync).toBe(true);
    expect(health.isStale).toBe(false);
    expect(health.hasError).toBe(false);
  });

  test("marks stale when last success older than threshold", () => {
    const old = new Date(now - PROVIDER_SYNC_STALE_MS - 1000).toISOString();
    const health = summarizeProviderSync(
      [
        {
          configured: true,
          status: "ok",
          lastSuccessAt: old,
          lastError: null,
        },
      ],
      now,
    );
    expect(health.isStale).toBe(true);
    expect(health.hasSuccessfulSync).toBe(true);
  });

  test("surfaces connector error with message", () => {
    const health = summarizeProviderSync(
      [
        {
          configured: true,
          status: "error",
          lastSuccessAt: "2026-07-30T11:00:00.000Z",
          lastError: "Admin key rejected",
        },
        {
          configured: true,
          status: "ok",
          lastSuccessAt: "2026-07-30T10:00:00.000Z",
          lastError: null,
        },
      ],
      now,
    );
    expect(health.hasError).toBe(true);
    expect(health.errorMessage).toBe("Admin key rejected");
    expect(health.hasSuccessfulSync).toBe(true);
  });
});

describe("formatDirectApiSpendPrimary", () => {
  test("pending shows ellipsis", () => {
    expect(
      formatDirectApiSpendPrimary(
        { cost: 1, hasCost: true },
        { hasSuccessfulSync: true },
        true,
      ),
    ).toBe("…");
  });

  test("never synced → No synced spend (not $0)", () => {
    expect(
      formatDirectApiSpendPrimary(
        { cost: 0, hasCost: false },
        { hasSuccessfulSync: false },
        false,
      ),
    ).toBe("No synced spend");
  });

  test("true zero after sync → $0.0000", () => {
    expect(
      formatDirectApiSpendPrimary(
        { cost: 0, hasCost: false },
        { hasSuccessfulSync: true },
        false,
      ),
    ).toBe("$0.0000");
  });

  test("populated cost formats to 4 decimals", () => {
    expect(
      formatDirectApiSpendPrimary(
        { cost: 1.095, hasCost: true },
        { hasSuccessfulSync: true },
        false,
      ),
    ).toBe("$1.0950");
  });
});

describe("formatDirectApiSpend30d", () => {
  test("never synced → em dash", () => {
    expect(
      formatDirectApiSpend30d(
        { cost: 0, hasCost: false },
        { hasSuccessfulSync: false },
        false,
      ),
    ).toBe("—");
  });

  test("synced zero → $0.0000", () => {
    expect(
      formatDirectApiSpend30d(
        { cost: 0, hasCost: false },
        { hasSuccessfulSync: true },
        false,
      ),
    ).toBe("$0.0000");
  });
});

describe("directApiSpendSyncStatusKind", () => {
  test("error wins over stale", () => {
    expect(
      directApiSpendSyncStatusKind({
        lastSuccessAt: "2026-01-01T00:00:00.000Z",
        isStale: true,
        hasError: true,
        errorMessage: "boom",
        hasSuccessfulSync: true,
        anyConfigured: true,
      }),
    ).toBe("error");
  });

  test("stale when no error", () => {
    expect(
      directApiSpendSyncStatusKind({
        lastSuccessAt: "2026-01-01T00:00:00.000Z",
        isStale: true,
        hasError: false,
        errorMessage: null,
        hasSuccessfulSync: true,
        anyConfigured: true,
      }),
    ).toBe("stale");
  });

  test("synced when fresh", () => {
    expect(
      directApiSpendSyncStatusKind({
        lastSuccessAt: "2026-07-30T11:00:00.000Z",
        isStale: false,
        hasError: false,
        errorMessage: null,
        hasSuccessfulSync: true,
        anyConfigured: true,
      }),
    ).toBe("synced");
  });

  test("none without success", () => {
    expect(
      directApiSpendSyncStatusKind({
        lastSuccessAt: null,
        isStale: false,
        hasError: false,
        errorMessage: null,
        hasSuccessfulSync: false,
        anyConfigured: false,
      }),
    ).toBe("none");
  });
});

describe("window helpers", () => {
  test("startOfLocalDayIso is midnight local", () => {
    const now = new Date(2026, 6, 30, 15, 30, 0).getTime(); // Jul 30 15:30 local
    const iso = startOfLocalDayIso(now);
    const d = new Date(iso);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getDate()).toBe(30);
  });

  test("daysAgoIso is approximately N days earlier", () => {
    const now = Date.parse("2026-07-30T12:00:00.000Z");
    const iso = daysAgoIso(30, now);
    expect(Date.parse(iso)).toBe(now - 30 * 24 * 60 * 60 * 1000);
  });
});
