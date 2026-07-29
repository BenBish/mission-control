/**
 * Heartbeat age thresholds used to compute effective source health.
 *
 * Collectors typically tick every ~30s and send a heartbeat each tick.
 * These defaults are intentionally much larger than a single interval so
 * brief blips do not flip status, but short enough that a multi-hour or
 * multi-day outage cannot remain green.
 *
 * Override via env (milliseconds) when the process starts:
 *   MC_HEARTBEAT_STALE_MS
 *   MC_HEARTBEAT_OFFLINE_MS
 */

const MINUTE = 60_000;

function parseMs(envValue: string | undefined, fallback: number): number {
  if (!envValue) return fallback;
  const n = Number(envValue);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Default: 5 minutes without a heartbeat → Stale */
export const DEFAULT_STALE_MS = 5 * MINUTE;

/** Default: 15 minutes without a heartbeat → Offline */
export const DEFAULT_OFFLINE_MS = 15 * MINUTE;

export const HEARTBEAT_THRESHOLDS = {
  /**
   * After this many milliseconds without a heartbeat the source is marked
   * as **Stale**. UI warns but the collector may still recover shortly.
   */
  stale: parseMs(
    typeof process !== "undefined"
      ? process.env?.MC_HEARTBEAT_STALE_MS
      : undefined,
    DEFAULT_STALE_MS,
  ),
  /**
   * After this many milliseconds without a heartbeat the source is marked
   * as **Offline**. Collector is not reporting.
   */
  offline: parseMs(
    typeof process !== "undefined"
      ? process.env?.MC_HEARTBEAT_OFFLINE_MS
      : undefined,
    DEFAULT_OFFLINE_MS,
  ),
} as const;
