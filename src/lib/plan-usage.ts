/**
 * Pure helpers for summarizing plan-usage (quota) credit rows for Dashboard KPIs.
 * Never treats percent remaining as dollars (five-data-classes rule).
 */

import { classifyPlanWindow, type CanonicalPlanSlot } from "./plan-windows.js";

export interface PlanUsageCreditLike {
  provider: string;
  remaining: number | null;
  total?: number | null;
  unit?: string;
  label: string;
  status: string;
  source?: string;
  details?: Record<string, unknown> | null;
}

export interface PlanUsageSlotView {
  slot: CanonicalPlanSlot | "extra";
  extraKey?: string;
  windowLabel: string;
  remainingPercent: number | null;
  status: string;
  label: string;
}

export interface PlanUsageProviderSummary {
  provider: string;
  /** Short display name, e.g. "Claude" / "OpenAI" */
  displayName: string;
  remainingPercent: number;
  windowLabel: string;
  label: string;
  fiveHour: PlanUsageSlotView;
  weekly: PlanUsageSlotView;
  extras: PlanUsageSlotView[];
}

export interface PlanUsageSummary {
  /** Single most constrained fresh *canonical* window (lowest remaining %). */
  mostConstrained: PlanUsageProviderSummary | null;
  /** One row per provider that has any plan-usage observation. */
  perProvider: PlanUsageProviderSummary[];
  hasFresh: boolean;
}

const PROVIDER_DISPLAY: Record<string, string> = {
  anthropic: "Claude",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  xai: "xAI",
};

const PROVIDER_ORDER = ["anthropic", "openai", "xai"];

export function providerDisplayName(provider: string): string {
  return (
    PROVIDER_DISPLAY[provider.toLowerCase()] ??
    provider.charAt(0).toUpperCase() + provider.slice(1)
  );
}

/**
 * Derive a short window label for UI chips from the canonical slot contract.
 */
export function shortWindowLabel(
  label: string,
  details?: Record<string, unknown> | null,
): string {
  const classified = classifyPlanWindow({
    limitId: typeof details?.limitId === "string" ? details.limitId : undefined,
    windowMinutes:
      typeof details?.windowMinutes === "number"
        ? details.windowMinutes
        : undefined,
    label,
  });
  if (classified.kind === "5h") return "5h";
  if (classified.kind === "wk") return "wk";
  if (classified.key === "opus_wk") return "Opus wk";
  if (classified.key === "month") return "mo";
  if (classified.key === "day") return "1d";
  if (classified.windowMinutes != null && classified.windowMinutes > 0) {
    const windowMinutes = classified.windowMinutes;
    if (windowMinutes < 60) return `${windowMinutes}m`;
    if (windowMinutes < 24 * 60) return `${Math.round(windowMinutes / 60)}h`;
    return `${Math.round(windowMinutes / (24 * 60))}d`;
  }
  return classified.key.slice(0, 12) || "plan";
}

function emptySlot(slot: CanonicalPlanSlot): PlanUsageSlotView {
  return {
    slot,
    windowLabel: slot,
    remainingPercent: null,
    status: "unavailable",
    label: slot === "5h" ? "quota_slot:5h" : "quota_slot:wk",
  };
}

function slotViewFromCredit(
  row: PlanUsageCreditLike,
  classifiedKind: CanonicalPlanSlot | "extra",
  extraKey?: string,
): PlanUsageSlotView {
  const remaining =
    row.remaining != null && Number.isFinite(row.remaining)
      ? Math.max(0, Math.min(100, Math.round(row.remaining)))
      : null;
  return {
    slot: classifiedKind,
    extraKey,
    windowLabel: shortWindowLabel(row.label, row.details),
    remainingPercent: remaining,
    status: row.status,
    label: row.label,
  };
}

function isPercentPlanRow(row: PlanUsageCreditLike): boolean {
  return row.unit == null || row.unit === "percent";
}

function isFreshCanonical(slot: PlanUsageSlotView): boolean {
  return (
    (slot.slot === "5h" || slot.slot === "wk") &&
    slot.status === "ok" &&
    slot.remainingPercent != null
  );
}

/**
 * Summarize plan-usage rows for Dashboard + Consumption.
 * Canonical 5h / weekly slots are always present per provider that has any
 * observation. Only status === "ok" counts as fresh for the KPI headline.
 */
export function summarizePlanUsage(
  planUsage: PlanUsageCreditLike[],
): PlanUsageSummary {
  const rows = planUsage.filter(isPercentPlanRow);
  const byProvider = new Map<string, PlanUsageCreditLike[]>();
  for (const row of rows) {
    const list = byProvider.get(row.provider) ?? [];
    list.push(row);
    byProvider.set(row.provider, list);
  }

  const perProvider: PlanUsageProviderSummary[] = Array.from(
    byProvider.entries(),
  )
    .map(([provider, providerRows]) =>
      summarizeProviderWindows(provider, providerRows),
    )
    .sort((a, b) => {
      const aFresh = a.fiveHour.status === "ok" || a.weekly.status === "ok";
      const bFresh = b.fiveHour.status === "ok" || b.weekly.status === "ok";
      if (aFresh && bFresh) return a.remainingPercent - b.remainingPercent;
      if (aFresh !== bFresh) return aFresh ? -1 : 1;
      return providerSortKey(a.provider) - providerSortKey(b.provider);
    });

  const withFresh = perProvider.filter(
    (p) => isFreshCanonical(p.fiveHour) || isFreshCanonical(p.weekly),
  );
  const mostConstrained = withFresh[0] ?? null;

  return {
    mostConstrained,
    perProvider,
    hasFresh: withFresh.length > 0,
  };
}

function summarizeProviderWindows(
  provider: string,
  rows: PlanUsageCreditLike[],
): PlanUsageProviderSummary {
  let fiveHour = emptySlot("5h");
  let weekly = emptySlot("wk");
  const extras: PlanUsageSlotView[] = [];

  for (const row of rows) {
    if (row.label === "plan_usage_unavailable") continue;
    const classified = classifyPlanWindow({
      limitId:
        typeof row.details?.limitId === "string"
          ? row.details.limitId
          : undefined,
      windowMinutes:
        typeof row.details?.windowMinutes === "number"
          ? row.details.windowMinutes
          : undefined,
      label: row.label,
    });
    if (classified.kind === "5h") {
      fiveHour = preferSlot(fiveHour, slotViewFromCredit(row, "5h"));
    } else if (classified.kind === "wk") {
      weekly = preferSlot(weekly, slotViewFromCredit(row, "wk"));
    } else {
      extras.push(slotViewFromCredit(row, "extra", classified.key));
    }
  }

  const tightest = [fiveHour, weekly]
    .filter(isFreshCanonical)
    .sort(
      (a, b) => (a.remainingPercent as number) - (b.remainingPercent as number),
    )[0];

  return {
    provider,
    displayName: providerDisplayName(provider),
    remainingPercent: tightest?.remainingPercent ?? 0,
    windowLabel: tightest?.windowLabel ?? fiveHour.windowLabel,
    label: tightest?.label ?? fiveHour.label,
    fiveHour,
    weekly,
    extras,
  };
}

function preferSlot(
  current: PlanUsageSlotView,
  next: PlanUsageSlotView,
): PlanUsageSlotView {
  if (current.status === "unavailable") return next;
  if (next.status === "unavailable") return current;
  if (current.status === "ok" && next.status !== "ok") return current;
  if (next.status === "ok" && current.status !== "ok") return next;
  return next;
}

function providerSortKey(provider: string): number {
  const idx = PROVIDER_ORDER.indexOf(provider.toLowerCase());
  return idx === -1 ? PROVIDER_ORDER.length : idx;
}

export function formatPlanSlotChip(slot: PlanUsageSlotView): string {
  if (slot.remainingPercent == null || slot.status === "unavailable") {
    return `— ${slot.windowLabel}`;
  }
  if (slot.status === "ok") {
    return `${slot.remainingPercent}% ${slot.windowLabel}`;
  }
  return `${slot.remainingPercent}% ${slot.windowLabel} ${slot.status}`;
}

export function formatProviderPlanLine(
  summary: PlanUsageProviderSummary,
): string {
  const extras = summary.extras.map(formatPlanSlotChip).join(" · ");
  const canonical = `${formatPlanSlotChip(summary.fiveHour)} · ${formatPlanSlotChip(summary.weekly)}`;
  return extras
    ? `${summary.displayName} ${canonical} · ${extras}`
    : `${summary.displayName} ${canonical}`;
}

/** Sort credits 5h → weekly → extras, grouped by subscription provider. */
export function sortPlanUsageCredits<T extends PlanUsageCreditLike>(
  credits: T[],
): T[] {
  return [...credits].sort((a, b) => {
    const providerCmp =
      providerSortKey(a.provider) - providerSortKey(b.provider);
    if (providerCmp !== 0) return providerCmp;
    return slotSortKey(a) - slotSortKey(b);
  });
}

function slotSortKey(row: PlanUsageCreditLike): number {
  if (row.label === "plan_usage_unavailable") return 90;
  const classified = classifyPlanWindow({
    limitId:
      typeof row.details?.limitId === "string"
        ? row.details.limitId
        : undefined,
    windowMinutes:
      typeof row.details?.windowMinutes === "number"
        ? row.details.windowMinutes
        : undefined,
    label: row.label,
  });
  if (classified.kind === "5h") return 0;
  if (classified.kind === "wk") return 1;
  return 10;
}

export function groupPlanUsageCredits<T extends PlanUsageCreditLike>(
  credits: T[],
): Array<{ provider: string; displayName: string; credits: T[] }> {
  const grouped = new Map<string, T[]>();
  for (const credit of sortPlanUsageCredits(credits)) {
    const list = grouped.get(credit.provider) ?? [];
    list.push(credit);
    grouped.set(credit.provider, list);
  }
  return Array.from(grouped.entries()).map(([provider, list]) => ({
    provider,
    displayName: providerDisplayName(provider),
    credits: list,
  }));
}
