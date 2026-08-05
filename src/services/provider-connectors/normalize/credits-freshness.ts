/**
 * BSH-96: Evaluate whether a stored capacity snapshot is still actionable.
 *
 * Plan-usage windows expire at resetsAt (preferred) or after windowMinutes
 * from asOf. Wallet balances go stale after a longer max age. Never leave an
 * obsolete plan-usage row as status "ok" (green) after its window has passed.
 */

import type { CapacitySurface, CreditStatus } from "../types.js";

/** Plan-usage rows with no window metadata become stale after this age. */
export const PLAN_USAGE_NO_WINDOW_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Wallet / prepaid balance snapshots go stale after this age without refresh. */
export const WALLET_STALE_MS = 7 * 24 * 60 * 60 * 1000;

export interface CreditFreshnessInput {
  status: string;
  asOf: string;
  surface: CapacitySurface;
  source?: string;
  label?: string;
  details?: Record<string, unknown> | null;
}

export interface CreditFreshnessResult {
  status: CreditStatus;
  /** Human-readable reason when demoted from ok. */
  freshnessReason?: string;
}

/** Parse trailing `_Nm` window from labels like quota_codex:secondary_10080m. */
export function parseWindowMinutesFromLabel(label: string): number | null {
  const m = label.match(/_(\d+)m$/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function asPositiveNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function resolveWindowMinutes(
  details: Record<string, unknown> | null | undefined,
  label: string | undefined,
): number | null {
  const fromDetails = asPositiveNumber(details?.windowMinutes);
  if (fromDetails != null) return fromDetails;
  if (label) return parseWindowMinutesFromLabel(label);
  return null;
}

/**
 * Demote ok capacity snapshots that are past their quota window or max age.
 * Non-ok statuses (unavailable, limited, error, already stale/expired) pass through.
 */
export function evaluateCreditFreshness(
  credit: CreditFreshnessInput,
  now: Date = new Date(),
): CreditFreshnessResult {
  const base = credit.status as CreditStatus;
  if (credit.status !== "ok") {
    return { status: base };
  }

  const nowMs = now.getTime();
  const asOfMs = Date.parse(credit.asOf);
  const asOfValid = Number.isFinite(asOfMs);

  if (credit.surface === "plan_usage") {
    const resetsRaw = credit.details?.resetsAt;
    if (typeof resetsRaw === "string" && resetsRaw.trim() !== "") {
      const resetMs = Date.parse(resetsRaw);
      if (Number.isFinite(resetMs) && nowMs >= resetMs) {
        return {
          status: "expired",
          freshnessReason:
            "Quota window has reset; this observation is no longer valid.",
        };
      }
    }

    const windowMinutes = resolveWindowMinutes(credit.details, credit.label);
    if (windowMinutes != null && asOfValid) {
      const windowEndMs = asOfMs + windowMinutes * 60_000;
      if (nowMs >= windowEndMs) {
        return {
          status: "expired",
          freshnessReason:
            "Quota window has elapsed since the last observation.",
        };
      }
    } else if (asOfValid && nowMs - asOfMs > PLAN_USAGE_NO_WINDOW_MAX_AGE_MS) {
      return {
        status: "stale",
        freshnessReason:
          "Plan-usage snapshot is older than the freshness threshold; collect a new session quota.",
      };
    }

    return { status: "ok" };
  }

  // wallet and other surfaces: age-based stale only
  if (asOfValid && nowMs - asOfMs > WALLET_STALE_MS) {
    return {
      status: "stale",
      freshnessReason:
        "Wallet snapshot is older than the freshness threshold; re-sync providers for current balance.",
    };
  }

  return { status: "ok" };
}
