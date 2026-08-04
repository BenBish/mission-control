/**
 * Effective source health — heartbeat age + persisted status.
 */

import { describe, expect, test } from "bun:test";
import {
  DEFAULT_OFFLINE_MS,
  DEFAULT_STALE_MS,
  resolveHeartbeatThresholds,
} from "../../config/heartbeatThresholds";
import {
  formatInstanceHealthTooltip,
  getEffectiveHealth,
  getSystemHealth,
  HEALTH_DOT_CLASS,
  type HealthInput,
} from "../../services/sourceHealth";

const NOW = Date.parse("2026-07-20T12:00:00.000Z");
const MINUTE = 60_000;
const THRESHOLDS = { stale: 5 * MINUTE, offline: 15 * MINUTE };

function iso(msAgo: number): string {
  return new Date(NOW - msAgo).toISOString();
}

function instance(partial: Partial<HealthInput> = {}): HealthInput {
  return {
    status: "ok",
    lastSeenAt: iso(30_000),
    lastError: null,
    ...partial,
  };
}

describe("getEffectiveHealth", () => {
  test("healthy when status is ok and heartbeat is fresh", () => {
    const health = getEffectiveHealth(
      instance({ lastSeenAt: iso(30_000) }),
      NOW,
      THRESHOLDS,
    );
    expect(health.status).toBe("Healthy");
    expect(health.lastSeenAt).toBe(iso(30_000));
  });

  test("stale just past the stale threshold (boundary)", () => {
    // age = stale + 1ms → Stale; age === stale is still Healthy
    const atBoundary = getEffectiveHealth(
      instance({ lastSeenAt: iso(THRESHOLDS.stale) }),
      NOW,
      THRESHOLDS,
    );
    expect(atBoundary.status).toBe("Healthy");

    const pastBoundary = getEffectiveHealth(
      instance({ lastSeenAt: iso(THRESHOLDS.stale + 1) }),
      NOW,
      THRESHOLDS,
    );
    expect(pastBoundary.status).toBe("Stale");
  });

  test("offline just past the offline threshold (long offline)", () => {
    const atBoundary = getEffectiveHealth(
      instance({ lastSeenAt: iso(THRESHOLDS.offline) }),
      NOW,
      THRESHOLDS,
    );
    expect(atBoundary.status).toBe("Stale");

    const pastBoundary = getEffectiveHealth(
      instance({ lastSeenAt: iso(THRESHOLDS.offline + 1) }),
      NOW,
      THRESHOLDS,
    );
    expect(pastBoundary.status).toBe("Offline");
  });

  test("five-day-old heartbeat is Offline even if persisted status is ok", () => {
    const fiveDays = 5 * 24 * 60 * MINUTE;
    const health = getEffectiveHealth(
      instance({ status: "ok", lastSeenAt: iso(fiveDays) }),
      NOW,
      THRESHOLDS,
    );
    expect(health.status).toBe("Offline");
  });

  test("explicit lastError yields Error regardless of age", () => {
    const health = getEffectiveHealth(
      instance({
        status: "ok",
        lastError: "connection refused",
        lastSeenAt: iso(1_000),
      }),
      NOW,
      THRESHOLDS,
    );
    expect(health.status).toBe("Error");
    expect(health.reason).toBe("connection refused");
  });

  test("persisted status error yields Error", () => {
    const health = getEffectiveHealth(
      instance({ status: "error", lastError: null, lastSeenAt: iso(1_000) }),
      NOW,
      THRESHOLDS,
    );
    expect(health.status).toBe("Error");
  });

  test("status off is Offline without requiring age", () => {
    const health = getEffectiveHealth(
      instance({ status: "off", lastSeenAt: null }),
      NOW,
      THRESHOLDS,
    );
    expect(health.status).toBe("Offline");
    expect(health.reason).toMatch(/not connected/i);
  });

  test("missing lastSeenAt is Unknown", () => {
    const health = getEffectiveHealth(
      instance({ lastSeenAt: null }),
      NOW,
      THRESHOLDS,
    );
    expect(health.status).toBe("Unknown");
  });
});

describe("getSystemHealth", () => {
  test("all healthy → Online", () => {
    expect(
      getSystemHealth(
        [instance(), instance({ status: "healthy" })],
        NOW,
        THRESHOLDS,
      ),
    ).toBe("Online");
  });

  test("one stale among healthy → Degraded", () => {
    expect(
      getSystemHealth(
        [
          instance({ lastSeenAt: iso(1_000) }),
          instance({ lastSeenAt: iso(THRESHOLDS.stale + 1) }),
        ],
        NOW,
        THRESHOLDS,
      ),
    ).toBe("Degraded");
  });

  test("any error → Error", () => {
    expect(
      getSystemHealth(
        [instance(), instance({ status: "error", lastError: "boom" })],
        NOW,
        THRESHOLDS,
      ),
    ).toBe("Error");
  });

  test("all offline/unknown → Offline", () => {
    expect(
      getSystemHealth(
        [
          instance({ lastSeenAt: iso(THRESHOLDS.offline + 1) }),
          instance({ lastSeenAt: null }),
        ],
        NOW,
        THRESHOLDS,
      ),
    ).toBe("Offline");
  });

  test("intentional off sources are excluded from rollup", () => {
    expect(
      getSystemHealth(
        [instance({ status: "off", lastSeenAt: null }), instance()],
        NOW,
        THRESHOLDS,
      ),
    ).toBe("Online");
  });

  test("only off sources → Online (nothing expected to report)", () => {
    expect(
      getSystemHealth(
        [instance({ status: "off", lastSeenAt: null })],
        NOW,
        THRESHOLDS,
      ),
    ).toBe("Online");
  });

  test("empty list → Unknown", () => {
    expect(getSystemHealth([], NOW, THRESHOLDS)).toBe("Unknown");
  });
});

describe("resolveHeartbeatThresholds", () => {
  test("returns defaults when called with no args", () => {
    expect(resolveHeartbeatThresholds()).toEqual({
      stale: DEFAULT_STALE_MS,
      offline: DEFAULT_OFFLINE_MS,
    });
  });

  test("accepts valid custom thresholds", () => {
    expect(resolveHeartbeatThresholds(60_000, 180_000)).toEqual({
      stale: 60_000,
      offline: 180_000,
    });
  });

  test("falls back to defaults when offline <= stale", () => {
    expect(resolveHeartbeatThresholds(10 * MINUTE, 5 * MINUTE)).toEqual({
      stale: DEFAULT_STALE_MS,
      offline: DEFAULT_OFFLINE_MS,
    });
    expect(resolveHeartbeatThresholds(5 * MINUTE, 5 * MINUTE)).toEqual({
      stale: DEFAULT_STALE_MS,
      offline: DEFAULT_OFFLINE_MS,
    });
  });

  test("falls back when non-positive values are provided", () => {
    expect(resolveHeartbeatThresholds(0, 15 * MINUTE)).toEqual({
      stale: DEFAULT_STALE_MS,
      offline: DEFAULT_OFFLINE_MS,
    });
  });

  test("getEffectiveHealth normalizes inverted thresholds before aging", () => {
    // inverted thresholds would make Stale unreachable without normalization
    const health = getEffectiveHealth(
      instance({ lastSeenAt: iso(THRESHOLDS.stale + 1) }),
      NOW,
      { stale: 15 * MINUTE, offline: 5 * MINUTE },
    );
    // falls back to defaults (5m stale / 15m offline) so age past 5m is Stale
    expect(health.status).toBe("Stale");
  });
});

describe("formatInstanceHealthTooltip", () => {
  test("uses effective labels, not raw ok/off", () => {
    const healthy = getEffectiveHealth(instance(), NOW, THRESHOLDS);
    expect(
      formatInstanceHealthTooltip("grok@arch-desktop", healthy, "ok"),
    ).toBe("grok@arch-desktop: Healthy (raw: ok)");

    const offline = getEffectiveHealth(
      instance({ status: "off", lastSeenAt: null }),
      NOW,
      THRESHOLDS,
    );
    const tip = formatInstanceHealthTooltip(
      "lemonade@strix-halo",
      offline,
      "off",
    );
    expect(tip).toContain("Offline");
    expect(tip).toContain("raw: off");
    expect(tip).not.toMatch(/: ok\b/);
  });

  test("includes reason when present (stale heartbeat)", () => {
    const stale = getEffectiveHealth(
      instance({ lastSeenAt: iso(THRESHOLDS.stale + 1) }),
      NOW,
      THRESHOLDS,
    );
    expect(stale.status).toBe("Stale");
    const tip = formatInstanceHealthTooltip("hermes@halo", stale, "ok");
    expect(tip).toContain("Stale");
    expect(tip).toContain("Heartbeat aging");
    expect(tip).toContain("raw: ok");
  });

  test("omits raw suffix when status is empty", () => {
    const health = getEffectiveHealth(instance(), NOW, THRESHOLDS);
    expect(formatInstanceHealthTooltip("x", health, "  ")).toBe("x: Healthy");
  });
});

describe("HEALTH_DOT_CLASS", () => {
  test("maps every HealthStatus to a distinct Tailwind bg class family", () => {
    expect(HEALTH_DOT_CLASS.Healthy).toContain("green");
    expect(HEALTH_DOT_CLASS.Stale).toContain("amber");
    expect(HEALTH_DOT_CLASS.Offline).toContain("muted");
    expect(HEALTH_DOT_CLASS.Error).toContain("red");
    expect(HEALTH_DOT_CLASS.Unknown).toContain("amber");
  });
});
