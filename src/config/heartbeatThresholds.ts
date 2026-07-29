/**
 * Heartbeat age thresholds used to compute effective source health.
 *
 * Collectors typically tick every ~30s and send a heartbeat each tick.
 * These defaults are intentionally much larger than a single interval so
 * brief blips do not flip status, but short enough that a multi-hour or
 * multi-day outage cannot remain green.
 *
 * These are **client-side defaults** evaluated in the browser. Server
 * process env (`MC_HEARTBEAT_*`) is not injected into the Vite bundle;
 * pass overrides into `resolveHeartbeatThresholds` (or wire
 * `import.meta.env.VITE_MC_HEARTBEAT_*` at build time) if you need
 * non-default values.
 */

const MINUTE = 60_000;

/** Default: 5 minutes without a heartbeat → Stale */
export const DEFAULT_STALE_MS = 5 * MINUTE;

/** Default: 15 minutes without a heartbeat → Offline */
export const DEFAULT_OFFLINE_MS = 15 * MINUTE;

export interface HeartbeatThresholds {
  stale: number;
  offline: number;
}

function positiveMs(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

/**
 * Normalize stale/offline thresholds. Requires offline > stale; otherwise
 * falls back to the built-in defaults so the Stale band remains reachable.
 */
export function resolveHeartbeatThresholds(
  staleMs: number = DEFAULT_STALE_MS,
  offlineMs: number = DEFAULT_OFFLINE_MS,
): HeartbeatThresholds {
  const stale = positiveMs(staleMs, DEFAULT_STALE_MS);
  const offline = positiveMs(offlineMs, DEFAULT_OFFLINE_MS);

  if (offline <= stale) {
    return { stale: DEFAULT_STALE_MS, offline: DEFAULT_OFFLINE_MS };
  }

  return { stale, offline };
}

function readViteNumber(key: string): number | undefined {
  try {
    // Vite injects import.meta.env at build time; absent in plain Node tests.
    const env = (import.meta as ImportMeta & { env?: Record<string, string> })
      .env;
    const raw = env?.[key];
    if (raw == null || raw === "") return undefined;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  } catch {
    return undefined;
  }
}

/** Resolved thresholds for the running client (defaults or VITE_* overrides). */
export const HEARTBEAT_THRESHOLDS: HeartbeatThresholds =
  resolveHeartbeatThresholds(
    readViteNumber("VITE_MC_HEARTBEAT_STALE_MS"),
    readViteNumber("VITE_MC_HEARTBEAT_OFFLINE_MS"),
  );
