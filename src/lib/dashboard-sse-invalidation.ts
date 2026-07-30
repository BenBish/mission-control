/**
 * Batched, selective Dashboard invalidation for SSE activity events (BSH-75).
 *
 * Dashboard used to call invalidateQueries for every query family on every
 * activity event. Bursts of SSE traffic produced one refetch triplet (or more)
 * per message. This module:
 *
 * 1. Selects only the query families an event can affect.
 * 2. Coalesces decisions over DASHBOARD_SSE_INVALIDATION_DEBOUNCE_MS, then
 *    flushes once so request volume is O(1) per family per burst window.
 * 3. On SSE reconnect (`system: connected`), schedules a full recovery set so
 *    data missed while disconnected is not stuck stale.
 */

import type { Activity } from "@/types/activity";

/** Query-key prefixes Dashboard may invalidate after SSE activity/reconnect. */
export type DashboardQueryFamily =
  | "activities"
  | "consumption"
  | "failures"
  | "provider-breakdown"
  | "provider-status";

/**
 * Freshness target for SSE-driven Dashboard invalidations.
 *
 * After the last activity (or reconnect) in a burst, wait this many ms before
 * flushing coalesced invalidations. UI may lag up to this window behind the
 * newest event; shorter values increase request volume under load.
 */
export const DASHBOARD_SSE_INVALIDATION_DEBOUNCE_MS = 300;

/** Full set used for reconnect recovery (missed events while disconnected). */
export const ALL_DASHBOARD_QUERY_FAMILIES: readonly DashboardQueryFamily[] = [
  "activities",
  "consumption",
  "failures",
  "provider-breakdown",
  "provider-status",
] as const;

/**
 * Decide which Dashboard query families an activity SSE event can affect.
 *
 * - activities: always — the recent list may change.
 * - failures: only when status is `failure` (matches failures SQL filter).
 * - consumption: only when token/cost fields can change daily totals.
 * - provider-breakdown / provider-status: never from activity events — that
 *   data comes from provider billing sync, not activity ingest.
 */
export function queryFamiliesForActivity(
  activity: Pick<
    Activity,
    | "status"
    | "inputTokens"
    | "outputTokens"
    | "totalTokens"
    | "cacheReadTokens"
    | "cacheWriteTokens"
    | "costUsd"
  >,
): DashboardQueryFamily[] {
  const families: DashboardQueryFamily[] = ["activities"];

  if (activity.status === "failure") {
    families.push("failures");
  }

  if (activityAffectsConsumption(activity)) {
    families.push("consumption");
  }

  return families;
}

function activityAffectsConsumption(
  activity: Pick<
    Activity,
    | "inputTokens"
    | "outputTokens"
    | "totalTokens"
    | "cacheReadTokens"
    | "cacheWriteTokens"
    | "costUsd"
  >,
): boolean {
  return (
    isPresentNumber(activity.inputTokens) ||
    isPresentNumber(activity.outputTokens) ||
    isPresentNumber(activity.totalTokens) ||
    isPresentNumber(activity.cacheReadTokens) ||
    isPresentNumber(activity.cacheWriteTokens) ||
    isPresentNumber(activity.costUsd)
  );
}

function isPresentNumber(value: number | undefined): boolean {
  return value != null && !Number.isNaN(value);
}

export type InvalidateFamilyFn = (family: DashboardQueryFamily) => void;

export interface DashboardInvalidationScheduler {
  /** Enqueue selective families for an activity event; debounced flush. */
  noteActivity: (
    activity: Parameters<typeof queryFamiliesForActivity>[0],
  ) => void;
  /** Enqueue full recovery set (SSE reconnect / connected); debounced flush. */
  noteReconnect: () => void;
  /** Flush immediately (tests / unmount). */
  flush: () => void;
  /** Cancel pending timer without flushing. */
  dispose: () => void;
  /** Pending families not yet flushed (for tests). */
  pendingFamilies: () => ReadonlySet<DashboardQueryFamily>;
}

export interface CreateSchedulerOptions {
  invalidate: InvalidateFamilyFn;
  /** Override debounce window (defaults to DASHBOARD_SSE_INVALIDATION_DEBOUNCE_MS). */
  debounceMs?: number;
  schedule?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearSchedule?: (id: ReturnType<typeof setTimeout>) => void;
}

/**
 * Create a coalescing invalidation scheduler.
 *
 * Multiple noteActivity/noteReconnect calls within the debounce window union
 * their query families and produce one invalidate call per family on flush.
 */
export function createDashboardInvalidationScheduler(
  options: CreateSchedulerOptions,
): DashboardInvalidationScheduler {
  const debounceMs =
    options.debounceMs ?? DASHBOARD_SSE_INVALIDATION_DEBOUNCE_MS;
  const schedule = options.schedule ?? setTimeout;
  const clearSchedule = options.clearSchedule ?? clearTimeout;

  const pending = new Set<DashboardQueryFamily>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer != null) {
      clearSchedule(timer);
      timer = null;
    }
  };

  const flush = () => {
    clearTimer();
    if (pending.size === 0) return;
    const families = [...pending];
    pending.clear();
    for (const family of families) {
      options.invalidate(family);
    }
  };

  const scheduleFlush = () => {
    clearTimer();
    timer = schedule(() => {
      timer = null;
      flush();
    }, debounceMs);
  };

  return {
    noteActivity(activity) {
      for (const family of queryFamiliesForActivity(activity)) {
        pending.add(family);
      }
      scheduleFlush();
    },
    noteReconnect() {
      for (const family of ALL_DASHBOARD_QUERY_FAMILIES) {
        pending.add(family);
      }
      scheduleFlush();
    },
    flush,
    dispose() {
      clearTimer();
      pending.clear();
    },
    pendingFamilies() {
      return pending;
    },
  };
}
