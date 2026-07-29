import {
  DEFAULT_OFFLINE_MS,
  DEFAULT_STALE_MS,
  HEARTBEAT_THRESHOLDS,
} from "../config/heartbeatThresholds";

export type HealthStatus =
  | "Healthy"
  | "Stale"
  | "Offline"
  | "Error"
  | "Unknown";

/** Aggregate sidebar / ops status across collector instances. */
export type SystemStatus =
  | "Online"
  | "Degraded"
  | "Offline"
  | "Error"
  | "Unknown";

export interface HealthInput {
  status: string;
  lastSeenAt: string | null;
  lastError: string | null;
}

export interface SourceHealth {
  status: HealthStatus;
  reason?: string;
  lastSeenAt: string | null;
}

export type HealthBadgeVariant =
  | "success"
  | "destructive"
  | "secondary"
  | "outline"
  | "warning";

/** Badge variants for effective health labels in the UI. */
export const HEALTH_BADGE_VARIANT: Record<HealthStatus, HealthBadgeVariant> = {
  Healthy: "success",
  Stale: "warning",
  Offline: "outline",
  Error: "destructive",
  Unknown: "secondary",
};

/** Left-border colors for Runtime health cards. */
export const HEALTH_BORDER_CLASS: Record<HealthStatus, string> = {
  Healthy: "border-l-green-500",
  Stale: "border-l-amber-500",
  Offline: "border-l-muted-foreground/30",
  Error: "border-l-red-500",
  Unknown: "border-l-muted-foreground/30",
};

const HEALTHY_STATUSES = new Set(["ok", "healthy", "on"]);

export interface Thresholds {
  stale: number;
  offline: number;
}

/**
 * Determine the effective health of a source instance.
 *
 * Priority:
 *   1. Explicit error (`lastError` or persisted status `error`) → Error
 *   2. Intentional quiet state (`off`) → Offline (not age-based)
 *   3. Missing `lastSeenAt` → Unknown
 *   4. Heartbeat older than offline threshold → Offline
 *   5. Heartbeat older than stale threshold → Stale
 *   6. Persisted healthy status + fresh heartbeat → Healthy
 *   7. Fallback → Unknown (or Offline when status is off-like)
 *
 * `now` and `thresholds` are injectable for deterministic tests.
 */
export function getEffectiveHealth(
  instance: HealthInput,
  now: number = Date.now(),
  thresholds: Thresholds = {
    stale: HEARTBEAT_THRESHOLDS.stale,
    offline: HEARTBEAT_THRESHOLDS.offline,
  },
): SourceHealth {
  const { status, lastSeenAt, lastError } = instance;
  const statusLower = (status ?? "").toLowerCase();

  if (lastError || statusLower === "error") {
    return {
      status: "Error",
      reason: lastError ?? "Collector reported an error",
      lastSeenAt,
    };
  }

  // Intentional quiet / never-connected sources stay Offline without
  // being aged as a failed heartbeat (and are excluded from system rollup).
  if (statusLower === "off") {
    return {
      status: "Offline",
      reason: "Not connected — no collector polling this source yet",
      lastSeenAt,
    };
  }

  if (!lastSeenAt) {
    return { status: "Unknown", lastSeenAt };
  }

  const lastSeenMs = new Date(lastSeenAt).getTime();
  if (Number.isNaN(lastSeenMs)) {
    return {
      status: "Unknown",
      lastSeenAt,
      reason: "Invalid last-seen timestamp",
    };
  }

  const ageMs = now - lastSeenMs;
  const staleMs = thresholds.stale > 0 ? thresholds.stale : DEFAULT_STALE_MS;
  const offlineMs =
    thresholds.offline > 0 ? thresholds.offline : DEFAULT_OFFLINE_MS;

  if (ageMs > offlineMs) {
    return { status: "Offline", lastSeenAt, reason: "Heartbeat expired" };
  }
  if (ageMs > staleMs) {
    return { status: "Stale", lastSeenAt, reason: "Heartbeat aging" };
  }

  if (HEALTHY_STATUSES.has(statusLower)) {
    return { status: "Healthy", lastSeenAt };
  }

  return {
    status: "Unknown",
    lastSeenAt,
    reason: `Unrecognized status: ${status}`,
  };
}

/**
 * Roll up instance health into a single system status for the sidebar.
 *
 * Intentionally quiet sources (`off`) are excluded so Lemonade/ComfyUI
 * that are not expected to run do not force Degraded forever.
 */
export function getSystemHealth(
  instances: HealthInput[],
  now: number = Date.now(),
  thresholds?: Thresholds,
): SystemStatus {
  const relevant = instances.filter(
    (i) => (i.status ?? "").toLowerCase() !== "off",
  );

  if (relevant.length === 0) {
    return instances.length > 0 ? "Online" : "Unknown";
  }

  const healths = relevant.map((i) => getEffectiveHealth(i, now, thresholds));

  if (healths.some((h) => h.status === "Error")) return "Error";

  const allDown = healths.every(
    (h) => h.status === "Offline" || h.status === "Unknown",
  );
  if (allDown) return "Offline";

  if (
    healths.some(
      (h) =>
        h.status === "Stale" ||
        h.status === "Offline" ||
        h.status === "Unknown",
    )
  ) {
    return "Degraded";
  }

  if (healths.every((h) => h.status === "Healthy")) return "Online";

  return "Degraded";
}

export const SYSTEM_STATUS_LABEL: Record<SystemStatus, string> = {
  Online: "System Online",
  Degraded: "System Degraded",
  Offline: "System Offline",
  Error: "System Error",
  Unknown: "System Unknown",
};

export const SYSTEM_STATUS_DOT_CLASS: Record<SystemStatus, string> = {
  Online: "bg-green-500 animate-pulse",
  Degraded: "bg-amber-500 animate-pulse",
  Offline: "bg-muted-foreground",
  Error: "bg-red-500 animate-pulse",
  Unknown: "bg-muted-foreground",
};
