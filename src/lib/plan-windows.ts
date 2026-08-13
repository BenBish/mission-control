/**
 * Canonical plan-usage windows for subscription providers (BSH-171).
 *
 * Every Claude / OpenAI / xAI subscription presents the same two slots:
 *   - 5h  (300 minutes)
 *   - wk  (10_080 minutes)
 *
 * Provider extras (Claude Opus weekly, Grok product bars, Grok month)
 * stay labeled separately and never occupy those slots.
 *
 * Do not invent remaining % when a provider does not expose a window —
 * persist/show status=unavailable for that slot instead.
 */

export const PLAN_WINDOW_FIVE_HOUR_MINUTES = 300;
export const PLAN_WINDOW_WEEKLY_MINUTES = 10_080;
export const PLAN_WINDOW_MONTH_MINUTES = 43_200;

export const CANONICAL_PLAN_SLOTS = ["5h", "wk"] as const;
export type CanonicalPlanSlot = (typeof CANONICAL_PLAN_SLOTS)[number];

export const CANONICAL_PLAN_WINDOW_MINUTES: Record<CanonicalPlanSlot, number> =
  {
    "5h": PLAN_WINDOW_FIVE_HOUR_MINUTES,
    wk: PLAN_WINDOW_WEEKLY_MINUTES,
  };

export const UNAVAILABLE_SLOT_LABEL: Record<CanonicalPlanSlot, string> = {
  "5h": "quota_slot:5h",
  wk: "quota_slot:wk",
};

/** Providers that show subscription plan bars (not OpenRouter wallet-only). */
export const SUBSCRIPTION_PLAN_PROVIDERS = [
  "anthropic",
  "openai",
  "xai",
] as const;

export type PlanWindowKind = CanonicalPlanSlot | "extra";

export interface ClassifiedPlanWindow {
  kind: PlanWindowKind;
  /** Canonical slot, or extra key (e.g. "opus_wk", "month", "imagine"). */
  key: string;
  windowMinutes: number | null;
}

const FIVE_HOUR_TOLERANCE_MIN = 30;
const WEEKLY_TOLERANCE_MIN = 12 * 60;

export function isCanonicalPlanSlot(
  value: string | null | undefined,
): value is CanonicalPlanSlot {
  return value === "5h" || value === "wk";
}

export function classifyPlanWindow(input: {
  limitId?: string | null;
  windowMinutes?: number | null;
  label?: string | null;
  periodType?: string | null;
}): ClassifiedPlanWindow {
  const limitId = (input.limitId ?? "").toLowerCase();
  const label = (input.label ?? "").toLowerCase();
  const period = (input.periodType ?? "").toLowerCase();
  const hay = `${limitId} ${label} ${period}`;
  const minutes =
    typeof input.windowMinutes === "number" &&
    Number.isFinite(input.windowMinutes)
      ? input.windowMinutes
      : null;

  if (isOpusExtra(hay)) {
    return {
      kind: "extra",
      key: "opus_wk",
      windowMinutes: minutes ?? PLAN_WINDOW_WEEKLY_MINUTES,
    };
  }
  if (isMonthWindow(hay, minutes)) {
    return {
      kind: "extra",
      key: "month",
      windowMinutes: minutes ?? PLAN_WINDOW_MONTH_MINUTES,
    };
  }
  if (isDayWindow(hay, minutes)) {
    return {
      kind: "extra",
      key: "day",
      windowMinutes: minutes ?? 1_440,
    };
  }
  const grokProduct = grokProductExtraKey(limitId);
  if (grokProduct) {
    return { kind: "extra", key: grokProduct, windowMinutes: minutes };
  }

  if (isFiveHourWindow(hay, minutes)) {
    return {
      kind: "5h",
      key: "5h",
      windowMinutes: minutes ?? PLAN_WINDOW_FIVE_HOUR_MINUTES,
    };
  }
  if (isWeeklyWindow(hay, minutes)) {
    return {
      kind: "wk",
      key: "wk",
      windowMinutes: minutes ?? PLAN_WINDOW_WEEKLY_MINUTES,
    };
  }

  return {
    kind: "extra",
    key: extraKeyFrom(limitId || label || "plan"),
    windowMinutes: minutes,
  };
}

export function canonicalSlotLabel(slot: CanonicalPlanSlot): string {
  return slot === "5h" ? "5-hour" : "weekly";
}

export function fillCanonicalPlanSlots<T>(
  snaps: T[],
  opts: {
    classify: (snap: T) => ClassifiedPlanWindow;
    buildUnavailable: (slot: CanonicalPlanSlot) => T;
  },
): T[] {
  if (snaps.length === 0) return snaps;
  const present = new Set<CanonicalPlanSlot>();
  for (const snap of snaps) {
    const classified = opts.classify(snap);
    if (classified.kind === "5h" || classified.kind === "wk") {
      present.add(classified.kind);
    }
  }
  const filled = [...snaps];
  for (const slot of CANONICAL_PLAN_SLOTS) {
    if (!present.has(slot)) {
      filled.push(opts.buildUnavailable(slot));
    }
  }
  return filled;
}

function isOpusExtra(hay: string): boolean {
  return hay.includes("7d_opus") || hay.includes("opus");
}

function isMonthWindow(hay: string, minutes: number | null): boolean {
  if (hay.includes("grok:month") || hay.includes("month")) return true;
  return minutes != null && minutes >= 28 * 1_440 && minutes <= 31 * 1_440;
}

function isDayWindow(hay: string, minutes: number | null): boolean {
  if (minutes === 1_440) return true;
  const hasDay = /\bday\b/.test(hay) || hay.includes(":day");
  const hasWeek = hay.includes("week") || hay.includes("seven_day");
  return hasDay && !hasWeek && !/\bmonth/.test(hay);
}

function grokProductExtraKey(limitId: string): string | null {
  if (!limitId.startsWith("grok:")) return null;
  const rest = limitId.slice("grok:".length);
  if (
    rest === "5h" ||
    rest === "week" ||
    rest === "plan" ||
    rest === "month" ||
    rest === "day"
  ) {
    return null;
  }
  return rest || null;
}

function isFiveHourWindow(hay: string, minutes: number | null): boolean {
  if (minutes != null) {
    if (
      Math.abs(minutes - PLAN_WINDOW_FIVE_HOUR_MINUTES) <=
      FIVE_HOUR_TOLERANCE_MIN
    ) {
      return true;
    }
    if (
      Math.abs(minutes - PLAN_WINDOW_WEEKLY_MINUTES) <= WEEKLY_TOLERANCE_MIN
    ) {
      return false;
    }
  }
  return (
    hay.includes("claude:5h") ||
    hay.includes("grok:5h") ||
    hay.includes(":5h") ||
    hay.includes("_5h") ||
    hay.includes("five_hour") ||
    hay.includes("5_hour") ||
    hay.includes("quota_slot:5h") ||
    hay.includes(":primary") ||
    hay.includes("_primary") ||
    /\bprimary\b/.test(hay)
  );
}

function isWeeklyWindow(hay: string, minutes: number | null): boolean {
  if (minutes != null) {
    if (
      Math.abs(minutes - PLAN_WINDOW_WEEKLY_MINUTES) <= WEEKLY_TOLERANCE_MIN
    ) {
      return true;
    }
    if (
      Math.abs(minutes - PLAN_WINDOW_FIVE_HOUR_MINUTES) <=
      FIVE_HOUR_TOLERANCE_MIN
    ) {
      return false;
    }
  }
  return (
    hay.includes("claude:7d") ||
    hay.includes("grok:week") ||
    hay.includes(":7d") ||
    hay.includes("_7d") ||
    hay.includes(":week") ||
    hay.includes("seven_day") ||
    hay.includes("quota_slot:wk") ||
    hay.includes(":secondary") ||
    hay.includes("_secondary") ||
    /\bsecondary\b/.test(hay) ||
    hay.includes("week")
  );
}

function extraKeyFrom(raw: string): string {
  return (
    raw
      .replace(/^quota_/i, "")
      .replace(/_\d+m$/i, "")
      .replace(/[^a-z0-9:]+/gi, "_")
      .slice(0, 32) || "plan"
  );
}
