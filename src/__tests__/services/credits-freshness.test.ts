/**
 * BSH-96: plan-usage / wallet capacity freshness rules.
 */

import { describe, expect, test } from "bun:test";
import {
  evaluateCreditFreshness,
  parseWindowMinutesFromLabel,
  PLAN_USAGE_NO_WINDOW_MAX_AGE_MS,
  WALLET_STALE_MS,
} from "../../services/provider-connectors/normalize/credits-freshness.js";
import { rowToApiCredit } from "../../db/queries/provider-credits.js";
import type { ProviderCreditSnapshotRow } from "../../db/queries/provider-credits.js";

const NOW = new Date("2026-08-05T12:00:00.000Z");

describe("parseWindowMinutesFromLabel", () => {
  test("parses Codex secondary 10080m label", () => {
    expect(parseWindowMinutesFromLabel("quota_codex:secondary_10080m")).toBe(
      10080,
    );
  });

  test("parses primary 300m", () => {
    expect(parseWindowMinutesFromLabel("quota_primary_300m")).toBe(300);
  });

  test("returns null without trailing window", () => {
    expect(parseWindowMinutesFromLabel("prepaid_balance")).toBeNull();
    expect(parseWindowMinutesFromLabel("quota_primary")).toBeNull();
  });
});

describe("evaluateCreditFreshness", () => {
  test("keeps fresh plan-usage ok when before resetsAt", () => {
    const r = evaluateCreditFreshness(
      {
        status: "ok",
        asOf: "2026-08-05T10:00:00.000Z",
        surface: "plan_usage",
        source: "session_quota",
        label: "quota_primary_300m",
        details: {
          windowMinutes: 300,
          resetsAt: "2026-08-05T15:00:00.000Z",
        },
      },
      NOW,
    );
    expect(r.status).toBe("ok");
    expect(r.freshnessReason).toBeUndefined();
  });

  test("expires plan-usage when resetsAt is in the past", () => {
    const r = evaluateCreditFreshness(
      {
        status: "ok",
        asOf: "2026-07-10T12:00:00.000Z",
        surface: "plan_usage",
        source: "session_quota",
        label: "quota_codex:secondary_10080m",
        details: {
          windowMinutes: 10080,
          resetsAt: "2026-07-17T12:00:00.000Z",
          usedPercent: 2,
        },
      },
      NOW,
    );
    expect(r.status).toBe("expired");
    expect(r.freshnessReason).toMatch(/reset/i);
  });

  test("expires when windowMinutes elapsed since asOf (no resetsAt)", () => {
    // 10080 minutes = 7 days; asOf July 10 → expired well before Aug 5
    const r = evaluateCreditFreshness(
      {
        status: "ok",
        asOf: "2026-07-10T12:00:00.000Z",
        surface: "plan_usage",
        source: "session_quota",
        label: "quota_codex:secondary_10080m",
        details: { windowMinutes: 10080 },
      },
      NOW,
    );
    expect(r.status).toBe("expired");
  });

  test("expires using window minutes parsed from label", () => {
    const r = evaluateCreditFreshness(
      {
        status: "ok",
        asOf: "2026-07-10T12:00:00.000Z",
        surface: "plan_usage",
        source: "session_quota",
        label: "quota_codex:secondary_10080m",
        details: {},
      },
      NOW,
    );
    expect(r.status).toBe("expired");
  });

  test("marks plan-usage stale when no window and past max age", () => {
    const asOf = new Date(
      NOW.getTime() - PLAN_USAGE_NO_WINDOW_MAX_AGE_MS - 1,
    ).toISOString();
    const r = evaluateCreditFreshness(
      {
        status: "ok",
        asOf,
        surface: "plan_usage",
        source: "session_quota",
        label: "quota_unknown",
        details: {},
      },
      NOW,
    );
    expect(r.status).toBe("stale");
  });

  test("does not demote unavailable / limited / error", () => {
    for (const status of [
      "unavailable",
      "limited",
      "error",
      "stale",
    ] as const) {
      const r = evaluateCreditFreshness(
        {
          status,
          asOf: "2020-01-01T00:00:00.000Z",
          surface: "plan_usage",
          label: "plan_usage_unavailable",
          details: {},
        },
        NOW,
      );
      expect(r.status).toBe(status);
    }
  });

  test("marks wallet stale after WALLET_STALE_MS", () => {
    const asOf = new Date(NOW.getTime() - WALLET_STALE_MS - 1).toISOString();
    const r = evaluateCreditFreshness(
      {
        status: "ok",
        asOf,
        surface: "wallet",
        source: "provider_api",
        label: "prepaid_balance",
        details: {},
      },
      NOW,
    );
    expect(r.status).toBe("stale");
  });

  test("keeps recent wallet ok", () => {
    const r = evaluateCreditFreshness(
      {
        status: "ok",
        asOf: "2026-08-04T12:00:00.000Z",
        surface: "wallet",
        source: "provider_api",
        label: "prepaid_balance",
        details: {},
      },
      NOW,
    );
    expect(r.status).toBe("ok");
  });
});

describe("rowToApiCredit applies freshness", () => {
  function row(
    overrides: Partial<ProviderCreditSnapshotRow> & {
      details?: Record<string, unknown>;
    },
  ): ProviderCreditSnapshotRow {
    const { details, ...rest } = overrides;
    return {
      id: 1,
      provider: "openai",
      as_of: "2026-07-10T12:00:00.000Z",
      remaining: 98,
      total: 100,
      unit: "percent",
      label: "quota_codex:secondary_10080m",
      source: "session_quota",
      status: "ok",
      details_json: JSON.stringify({
        surface: "plan_usage",
        windowMinutes: 10080,
        resetsAt: "2026-07-17T12:00:00.000Z",
        ...(details ?? {}),
      }),
      updated_at: "2026-07-10T12:00:00.000Z",
      ...rest,
    };
  }

  test("demotes obsolete Codex secondary quota from ok to expired", () => {
    const api = rowToApiCredit(row({}), NOW);
    expect(api.status).toBe("expired");
    expect(api.remaining).toBe(98);
    expect(api.details?.freshnessReason).toMatch(/reset|elapsed/i);
  });

  test("preserves fresh ok snapshots", () => {
    const api = rowToApiCredit(
      row({
        as_of: "2026-08-05T11:00:00.000Z",
        details: {
          surface: "plan_usage",
          windowMinutes: 300,
          resetsAt: "2026-08-05T16:00:00.000Z",
        },
      }),
      NOW,
    );
    expect(api.status).toBe("ok");
    expect(api.details?.freshnessReason).toBeUndefined();
  });
});
