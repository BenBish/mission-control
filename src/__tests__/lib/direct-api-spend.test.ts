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
  isCompactSpendPrimary,
  localDayKey,
  startOfLocalDayIso,
  daysAgoIso,
  PROVIDER_SYNC_STALE_MS,
  type DirectApiSpendFormatInput,
} from "../../lib/direct-api-spend.js";

function formatInput(
  overrides: Partial<DirectApiSpendFormatInput> = {},
): DirectApiSpendFormatInput {
  return {
    totals: { cost: 0, hasCost: false },
    pending: false,
    loadError: false,
    statusError: false,
    statusPending: false,
    hasSuccessfulSync: false,
    breakdownLoaded: false,
    ...overrides,
  };
}

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
        formatInput({
          totals: { cost: 1, hasCost: true },
          pending: true,
          hasSuccessfulSync: true,
          breakdownLoaded: true,
        }),
      ),
    ).toBe("…");
  });

  test("never synced → No synced spend (not $0)", () => {
    expect(
      formatDirectApiSpendPrimary(
        formatInput({
          breakdownLoaded: true,
          hasSuccessfulSync: false,
        }),
      ),
    ).toBe("No synced spend");
  });

  test("true zero after sync → $0.0000", () => {
    expect(
      formatDirectApiSpendPrimary(
        formatInput({
          breakdownLoaded: true,
          hasSuccessfulSync: true,
        }),
      ),
    ).toBe("$0.0000");
  });

  test("populated cost formats to 4 decimals", () => {
    expect(
      formatDirectApiSpendPrimary(
        formatInput({
          totals: { cost: 1.095, hasCost: true },
          breakdownLoaded: true,
          hasSuccessfulSync: true,
        }),
      ),
    ).toBe("$1.0950");
  });

  test("breakdown load error → em dash (not $0)", () => {
    expect(
      formatDirectApiSpendPrimary(
        formatInput({
          loadError: true,
          hasSuccessfulSync: true,
          breakdownLoaded: false,
        }),
      ),
    ).toBe("—");
    expect(
      formatDirectApiSpendPrimary(
        formatInput({
          loadError: true,
          hasSuccessfulSync: true,
        }),
      ),
    ).not.toBe("$0.0000");
  });

  test("status error still shows cost when breakdown has spend", () => {
    expect(
      formatDirectApiSpendPrimary(
        formatInput({
          totals: { cost: 2.5, hasCost: true },
          statusError: true,
          breakdownLoaded: true,
          hasSuccessfulSync: false,
        }),
      ),
    ).toBe("$2.5000");
  });

  test("status error without cost → em dash", () => {
    expect(
      formatDirectApiSpendPrimary(
        formatInput({
          statusError: true,
          breakdownLoaded: true,
          hasSuccessfulSync: false,
        }),
      ),
    ).toBe("—");
  });

  test("status pending + empty totals → ellipsis (not No synced spend)", () => {
    expect(
      formatDirectApiSpendPrimary(
        formatInput({
          breakdownLoaded: true,
          statusPending: true,
          hasSuccessfulSync: false,
        }),
      ),
    ).toBe("…");
  });

  test("status pending then success settles to true zero", () => {
    expect(
      formatDirectApiSpendPrimary(
        formatInput({
          breakdownLoaded: true,
          statusPending: true,
          hasSuccessfulSync: false,
        }),
      ),
    ).toBe("…");
    expect(
      formatDirectApiSpendPrimary(
        formatInput({
          breakdownLoaded: true,
          statusPending: false,
          hasSuccessfulSync: true,
        }),
      ),
    ).toBe("$0.0000");
  });

  test("status pending still shows cost when present", () => {
    expect(
      formatDirectApiSpendPrimary(
        formatInput({
          totals: { cost: 1.5, hasCost: true },
          breakdownLoaded: true,
          statusPending: true,
          hasSuccessfulSync: false,
        }),
      ),
    ).toBe("$1.5000");
  });
});

describe("formatDirectApiSpend30d", () => {
  test("never synced → em dash", () => {
    expect(
      formatDirectApiSpend30d(
        formatInput({
          breakdownLoaded: true,
          hasSuccessfulSync: false,
        }),
      ),
    ).toBe("—");
  });

  test("synced zero → $0.0000", () => {
    expect(
      formatDirectApiSpend30d(
        formatInput({
          breakdownLoaded: true,
          hasSuccessfulSync: true,
        }),
      ),
    ).toBe("$0.0000");
  });

  test("load error → em dash", () => {
    expect(
      formatDirectApiSpend30d(
        formatInput({
          loadError: true,
          hasSuccessfulSync: true,
        }),
      ),
    ).toBe("—");
  });

  test("status pending + empty → ellipsis", () => {
    expect(
      formatDirectApiSpend30d(
        formatInput({
          breakdownLoaded: true,
          statusPending: true,
          hasSuccessfulSync: false,
        }),
      ),
    ).toBe("…");
  });
});

describe("directApiSpendSyncStatusKind", () => {
  test("statusError wins over connector state", () => {
    expect(
      directApiSpendSyncStatusKind(
        {
          lastSuccessAt: "2026-07-30T11:00:00.000Z",
          isStale: false,
          hasError: true,
          errorMessage: "boom",
          hasSuccessfulSync: true,
          anyConfigured: true,
        },
        true,
      ),
    ).toBe("status-unavailable");
  });

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

describe("isCompactSpendPrimary", () => {
  test("dollar amounts and pending are full size", () => {
    expect(isCompactSpendPrimary("$1.0950")).toBe(false);
    expect(isCompactSpendPrimary("…")).toBe(false);
  });

  test("unavailable strings are compact", () => {
    expect(isCompactSpendPrimary("No synced spend")).toBe(true);
    expect(isCompactSpendPrimary("—")).toBe(true);
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

  test("localDayKey is stable within a calendar day", () => {
    const morning = new Date(2026, 6, 30, 1, 0, 0).getTime();
    const evening = new Date(2026, 6, 30, 23, 0, 0).getTime();
    const nextDay = new Date(2026, 6, 31, 1, 0, 0).getTime();
    expect(localDayKey(morning)).toBe(localDayKey(evening));
    expect(localDayKey(morning)).not.toBe(localDayKey(nextDay));
  });
});
