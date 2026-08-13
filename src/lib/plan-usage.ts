/**
 * Pure helpers for summarizing plan-usage (quota) credit rows for Dashboard KPIs.
 * Never treats percent remaining as dollars (five-data-classes rule).
 */

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

export interface PlanUsageProviderSummary {
  provider: string;
  /** Short display name, e.g. "Claude" / "OpenAI" */
  displayName: string;
  remainingPercent: number;
  windowLabel: string;
  label: string;
}

export interface PlanUsageSummary {
  /** Single most constrained fresh window across providers (lowest remaining %). */
  mostConstrained: PlanUsageProviderSummary | null;
  /** One row per provider (its tightest fresh window). */
  perProvider: PlanUsageProviderSummary[];
  hasFresh: boolean;
}

const PROVIDER_DISPLAY: Record<string, string> = {
  anthropic: "Claude",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  xai: "xAI",
};

export function providerDisplayName(provider: string): string {
  return (
    PROVIDER_DISPLAY[provider.toLowerCase()] ??
    provider.charAt(0).toUpperCase() + provider.slice(1)
  );
}

/**
 * Derive a short window label for UI chips.
 * - claude:5h / *5h* / 300m → "5h"
 * - *10080m* / 7d / week → "wk"
 * - otherwise strip quota_ prefix / truncate
 */
export function shortWindowLabel(
  label: string,
  details?: Record<string, unknown> | null,
): string {
  const limitId =
    typeof details?.limitId === "string" ? details.limitId : undefined;
  const windowMinutes =
    typeof details?.windowMinutes === "number"
      ? details.windowMinutes
      : undefined;

  const hay = `${label} ${limitId ?? ""}`.toLowerCase();

  if (
    hay.includes("claude:5h") ||
    hay.includes(":5h") ||
    hay.includes("_5h") ||
    hay.includes("300m") ||
    windowMinutes === 300
  ) {
    return "5h";
  }
  if (
    hay.includes("claude:7d") ||
    hay.includes("claude:7d_opus") ||
    hay.includes("grok:week") ||
    hay.includes(":7d") ||
    hay.includes("_7d") ||
    hay.includes(":week") ||
    hay.includes("10080m") ||
    windowMinutes === 10080
  ) {
    return "wk";
  }
  if (windowMinutes != null && windowMinutes > 0) {
    if (windowMinutes < 60) return `${windowMinutes}m`;
    if (windowMinutes < 24 * 60) return `${Math.round(windowMinutes / 60)}h`;
    return `${Math.round(windowMinutes / (24 * 60))}d`;
  }
  // Fallback: strip common prefixes
  const cleaned = label
    .replace(/^quota_/i, "")
    .replace(/_\d+m$/i, "")
    .slice(0, 12);
  return cleaned || "plan";
}

/**
 * Summarize plan-usage rows for Dashboard.
 * Only status === "ok" counts as fresh; expired/stale/unavailable are excluded.
 */
export function summarizePlanUsage(
  planUsage: PlanUsageCreditLike[],
): PlanUsageSummary {
  const fresh = planUsage.filter(
    (c) =>
      c.status === "ok" &&
      c.remaining != null &&
      Number.isFinite(c.remaining) &&
      (c.unit == null || c.unit === "percent"),
  );

  const byProvider = new Map<string, PlanUsageCreditLike>();
  for (const row of fresh) {
    const prev = byProvider.get(row.provider);
    if (!prev || (row.remaining as number) < (prev.remaining as number)) {
      byProvider.set(row.provider, row);
    }
  }

  const perProvider: PlanUsageProviderSummary[] = Array.from(
    byProvider.values(),
  )
    .map((row) => ({
      provider: row.provider,
      displayName: providerDisplayName(row.provider),
      remainingPercent: Math.max(
        0,
        Math.min(100, Math.round(row.remaining as number)),
      ),
      windowLabel: shortWindowLabel(row.label, row.details),
      label: row.label,
    }))
    .sort((a, b) => a.remainingPercent - b.remainingPercent);

  const mostConstrained = perProvider[0] ?? null;

  return {
    mostConstrained,
    perProvider,
    hasFresh: perProvider.length > 0,
  };
}
