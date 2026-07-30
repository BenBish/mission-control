/**
 * BSH-75: batched selective Dashboard SSE invalidation.
 *
 * Drives the real createDashboardInvalidationScheduler / queryFamiliesForActivity
 * under simulated burst traffic and selective rules. Uses fake timers so the
 * debounce window is exercised without wall-clock waits.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import {
  ALL_DASHBOARD_QUERY_FAMILIES,
  createDashboardInvalidationScheduler,
  DASHBOARD_SSE_INVALIDATION_DEBOUNCE_MS,
  queryFamiliesForActivity,
  type DashboardQueryFamily,
} from "../../lib/dashboard-sse-invalidation";
import type { Activity } from "../../types/activity";

function baseActivity(
  overrides: Partial<Activity> = {},
): Parameters<typeof queryFamiliesForActivity>[0] {
  return {
    status: "success",
    ...overrides,
  };
}

describe("queryFamiliesForActivity", () => {
  test("always includes activities", () => {
    expect(queryFamiliesForActivity(baseActivity())).toContain("activities");
  });

  test("non-failure activity does not include failures", () => {
    for (const status of ["success", "pending", "partial"] as const) {
      const families = queryFamiliesForActivity(baseActivity({ status }));
      expect(families).not.toContain("failures");
    }
  });

  test("failure-relevant activity includes failures", () => {
    expect(
      queryFamiliesForActivity(baseActivity({ status: "failure" })),
    ).toEqual(expect.arrayContaining(["activities", "failures"]));
  });

  test("activity with no token/cost impact does not include consumption", () => {
    const families = queryFamiliesForActivity(
      baseActivity({
        status: "success",
        inputTokens: undefined,
        outputTokens: undefined,
        totalTokens: undefined,
        costUsd: undefined,
      }),
    );
    expect(families).not.toContain("consumption");
    expect(families).not.toContain("provider-breakdown");
  });

  test("activity with tokens includes consumption", () => {
    expect(
      queryFamiliesForActivity(
        baseActivity({ inputTokens: 100, outputTokens: 50 }),
      ),
    ).toContain("consumption");
  });

  test("activity with costUsd includes consumption", () => {
    expect(
      queryFamiliesForActivity(baseActivity({ costUsd: 0.001 })),
    ).toContain("consumption");
  });

  test("activity with only cache tokens includes consumption", () => {
    expect(
      queryFamiliesForActivity(baseActivity({ cacheReadTokens: 10 })),
    ).toContain("consumption");
    expect(
      queryFamiliesForActivity(baseActivity({ cacheWriteTokens: 5 })),
    ).toContain("consumption");
  });

  test("zero token counts still count as consumption-relevant (field present)", () => {
    // Measured zeros still update SUM aggregates / grouping presence.
    expect(
      queryFamiliesForActivity(
        baseActivity({ inputTokens: 0, outputTokens: 0 }),
      ),
    ).toContain("consumption");
  });

  test("never invalidates provider-breakdown from activity events", () => {
    const withCost = queryFamiliesForActivity(
      baseActivity({
        status: "failure",
        inputTokens: 10,
        costUsd: 0.5,
      }),
    );
    expect(withCost).not.toContain("provider-breakdown");
  });

  test("never invalidates provider-status from activity events", () => {
    const withCost = queryFamiliesForActivity(
      baseActivity({
        status: "failure",
        inputTokens: 10,
        costUsd: 0.5,
      }),
    );
    expect(withCost).not.toContain("provider-status");
  });
});

describe("ALL_DASHBOARD_QUERY_FAMILIES", () => {
  test("includes provider-status for reconnect recovery", () => {
    expect(ALL_DASHBOARD_QUERY_FAMILIES).toContain("provider-status");
    expect(ALL_DASHBOARD_QUERY_FAMILIES).toContain("provider-breakdown");
  });
});

describe("createDashboardInvalidationScheduler", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function trackInvalidations() {
    const calls: DashboardQueryFamily[] = [];
    const invalidate = (family: DashboardQueryFamily) => {
      calls.push(family);
    };
    const scheduler = createDashboardInvalidationScheduler({
      invalidate,
      debounceMs: DASHBOARD_SSE_INVALIDATION_DEBOUNCE_MS,
    });
    return {
      calls,
      scheduler,
      countByFamily: () => {
        const map = new Map<DashboardQueryFamily, number>();
        for (const f of calls) {
          map.set(f, (map.get(f) ?? 0) + 1);
        }
        return map;
      },
    };
  }

  test("burst of N≥5 activity events produces O(1) invalidations per family", () => {
    const { calls, scheduler, countByFamily } = trackInvalidations();
    const N = 12;

    for (let i = 0; i < N; i++) {
      scheduler.noteActivity(
        baseActivity({
          status: "success",
          inputTokens: 10 + i,
          outputTokens: 5,
        }),
      );
    }

    // Still within the window — nothing flushed yet.
    expect(calls).toEqual([]);
    expect(scheduler.pendingFamilies().has("activities")).toBe(true);
    expect(scheduler.pendingFamilies().has("consumption")).toBe(true);

    jest.advanceTimersByTime(DASHBOARD_SSE_INVALIDATION_DEBOUNCE_MS);

    const counts = countByFamily();
    // Bound: one flush per family, not ≈ N.
    expect(counts.get("activities")).toBe(1);
    expect(counts.get("consumption")).toBe(1);
    expect(counts.get("failures")).toBeUndefined();
    expect(counts.get("provider-breakdown")).toBeUndefined();
    expect(calls.length).toBe(2);
    expect(calls.length).toBeLessThan(N);
  });

  test("non-failure activity does not invalidate failures after flush", () => {
    const { calls, scheduler } = trackInvalidations();
    scheduler.noteActivity(baseActivity({ status: "success" }));
    jest.advanceTimersByTime(DASHBOARD_SSE_INVALIDATION_DEBOUNCE_MS);
    expect(calls).toEqual(["activities"]);
    expect(calls).not.toContain("failures");
  });

  test("activity with no token/cost impact does not invalidate consumption", () => {
    const { calls, scheduler } = trackInvalidations();
    scheduler.noteActivity(baseActivity({ status: "success" }));
    jest.advanceTimersByTime(DASHBOARD_SSE_INVALIDATION_DEBOUNCE_MS);
    expect(calls).toEqual(["activities"]);
    expect(calls).not.toContain("consumption");
  });

  test("failure-relevant activity does invalidate failures after flush", () => {
    const { calls, scheduler } = trackInvalidations();
    scheduler.noteActivity(baseActivity({ status: "failure" }));
    expect(calls).toEqual([]); // not yet
    jest.advanceTimersByTime(DASHBOARD_SSE_INVALIDATION_DEBOUNCE_MS);
    expect(calls).toEqual(expect.arrayContaining(["activities", "failures"]));
    expect(calls).toHaveLength(2);
  });

  test("mixed burst unions families once each", () => {
    const { countByFamily, scheduler } = trackInvalidations();

    scheduler.noteActivity(baseActivity({ status: "success" })); // activities
    scheduler.noteActivity(baseActivity({ status: "success", inputTokens: 1 })); // +consumption
    scheduler.noteActivity(baseActivity({ status: "failure" })); // +failures
    scheduler.noteActivity(
      baseActivity({ status: "failure", outputTokens: 9 }),
    ); // already have all three

    jest.advanceTimersByTime(DASHBOARD_SSE_INVALIDATION_DEBOUNCE_MS);

    const counts = countByFamily();
    expect(counts.get("activities")).toBe(1);
    expect(counts.get("consumption")).toBe(1);
    expect(counts.get("failures")).toBe(1);
    expect(counts.get("provider-breakdown")).toBeUndefined();
  });

  test("debounce resets on each note within the window", () => {
    const { calls, scheduler } = trackInvalidations();
    const half = Math.floor(DASHBOARD_SSE_INVALIDATION_DEBOUNCE_MS / 2);

    scheduler.noteActivity(baseActivity());
    jest.advanceTimersByTime(half);
    expect(calls).toEqual([]);

    scheduler.noteActivity(baseActivity({ inputTokens: 3 }));
    jest.advanceTimersByTime(half);
    // Still waiting full window after the second note.
    expect(calls).toEqual([]);

    jest.advanceTimersByTime(half + 1);
    expect(calls).toEqual(
      expect.arrayContaining(["activities", "consumption"]),
    );
  });

  test("reconnect/connected triggers full recovery invalidation set", () => {
    const { calls, scheduler, countByFamily } = trackInvalidations();

    scheduler.noteReconnect();
    expect(calls).toEqual([]);

    jest.advanceTimersByTime(DASHBOARD_SSE_INVALIDATION_DEBOUNCE_MS);

    const counts = countByFamily();
    for (const family of ALL_DASHBOARD_QUERY_FAMILIES) {
      expect(counts.get(family)).toBe(1);
    }
    expect(calls).toHaveLength(ALL_DASHBOARD_QUERY_FAMILIES.length);
  });

  test("reconnect after selective notes expands to full recovery set", () => {
    const { countByFamily, scheduler } = trackInvalidations();

    scheduler.noteActivity(baseActivity({ status: "success" })); // activities only
    scheduler.noteReconnect(); // upgrade to full set

    jest.advanceTimersByTime(DASHBOARD_SSE_INVALIDATION_DEBOUNCE_MS);

    const counts = countByFamily();
    for (const family of ALL_DASHBOARD_QUERY_FAMILIES) {
      expect(counts.get(family)).toBe(1);
    }
  });

  test("dispose cancels pending flush without invalidating", () => {
    const { calls, scheduler } = trackInvalidations();
    scheduler.noteActivity(baseActivity({ status: "failure", inputTokens: 1 }));
    scheduler.dispose();
    jest.advanceTimersByTime(DASHBOARD_SSE_INVALIDATION_DEBOUNCE_MS * 2);
    expect(calls).toEqual([]);
  });

  test("manual flush drains immediately", () => {
    const { calls, scheduler } = trackInvalidations();
    scheduler.noteActivity(baseActivity({ status: "failure" }));
    scheduler.flush();
    expect(calls).toEqual(expect.arrayContaining(["activities", "failures"]));
    // Timer should not double-fire.
    jest.advanceTimersByTime(DASHBOARD_SSE_INVALIDATION_DEBOUNCE_MS * 2);
    expect(calls).toHaveLength(2);
  });

  test("freshness constant is a positive finite bound", () => {
    expect(DASHBOARD_SSE_INVALIDATION_DEBOUNCE_MS).toBeGreaterThan(0);
    expect(DASHBOARD_SSE_INVALIDATION_DEBOUNCE_MS).toBeLessThanOrEqual(2000);
    expect(Number.isFinite(DASHBOARD_SSE_INVALIDATION_DEBOUNCE_MS)).toBe(true);
  });
});
