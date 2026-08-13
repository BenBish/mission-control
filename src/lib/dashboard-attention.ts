/**
 * Pure builder for the Dashboard "Needs attention" strip (BSH-144).
 *
 * Composes signals already computed elsewhere (failures, plan-usage,
 * spend-insight alerts/anomalies/recommendations) into a short action list.
 * Never invents new collection and never mixes quota % with dollars.
 */

import type { PlanUsageSummary } from "./plan-usage";
import type {
  CapacityAlertConfig,
  OptimizationRecommendation,
  ScopedBudgetProgress,
  SpendAlert,
  SpendAnomaly,
  SpendInsights,
  SpendInsightsBreakdownRow,
} from "./queries";

export type AttentionSeverity = "critical" | "warn" | "info";
export type AttentionKind =
  | "failure"
  | "plan-usage"
  | "wallet"
  | "budget"
  | "anomaly"
  | "spend-mover";

export interface DashboardAttentionItem {
  id: string;
  kind: AttentionKind;
  severity: AttentionSeverity;
  title: string;
  detail: string;
  href: string;
}

/** Matches `defaultCapacityAlertConfig` — kept local so the UI lib stays browser-safe. */
export const DEFAULT_PLAN_USAGE_WARN_REMAINING_PCT = 20;
export const DEFAULT_PLAN_USAGE_CRITICAL_REMAINING_PCT = 5;

const MAX_ITEMS = 5;
const SPEND_MOVER_MIN_DELTA_USD = 1;
const SPEND_MOVER_MIN_DELTA_PCT = 40;

export interface BuildDashboardAttentionInput {
  failureLast24Hours?: number;
  openRuntimeEvents?: number;
  planUsage?: PlanUsageSummary | null;
  capacitySettings?: Pick<
    CapacityAlertConfig,
    "planUsageWarnRemainingPct" | "planUsageCriticalRemainingPct"
  > | null;
  budget?: SpendInsights["budget"] | null;
  scopedBudgets?: ScopedBudgetProgress[];
  alerts?: SpendAlert[];
  anomalies?: SpendAnomaly[];
  recommendations?: OptimizationRecommendation[];
  topBreakdown?: SpendInsightsBreakdownRow[];
}

export function resolveAttentionHref(hint: string | null | undefined): string {
  if (!hint) return "/consumption?view=direct-api";
  if (hint.startsWith("/")) return hint;
  if (hint.startsWith("#")) return `/consumption?view=direct-api${hint}`;
  return "/consumption?view=direct-api";
}

function formatUsd(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 100) return `${sign}$${Math.round(abs)}`;
  return `${sign}$${abs.toFixed(2)}`;
}

function alertKind(alert: SpendAlert): AttentionKind {
  if (alert.dataClass === "quota") return "plan-usage";
  if (alert.dataClass === "wallet") return "wallet";
  if (alert.kind === "anomaly") return "anomaly";
  return "budget";
}

function alertHref(alert: SpendAlert): string {
  if (alert.dataClass === "quota" || alert.dataClass === "wallet") {
    return "/consumption?view=direct-api#capacity";
  }
  return "/consumption?view=direct-api";
}

function isActiveAlert(alert: SpendAlert): boolean {
  return (
    alert.deliveryState !== "acknowledged" &&
    alert.deliveryState !== "suppressed"
  );
}

function severityRank(s: AttentionSeverity): number {
  if (s === "critical") return 0;
  if (s === "warn") return 1;
  return 2;
}

export function buildDashboardAttentionItems(
  input: BuildDashboardAttentionInput,
): DashboardAttentionItem[] {
  const items: DashboardAttentionItem[] = [];

  const fail24 = input.failureLast24Hours ?? 0;
  const openRt = input.openRuntimeEvents ?? 0;
  if (fail24 > 0 || openRt > 0) {
    const parts: string[] = [];
    if (fail24 > 0) {
      parts.push(`${fail24.toLocaleString()} in the last 24 hours`);
    }
    if (openRt > 0) {
      parts.push(`${openRt.toLocaleString()} open runtime`);
    }
    items.push({
      id: "failures",
      kind: "failure",
      severity: fail24 >= 10 || openRt >= 3 ? "critical" : "warn",
      title:
        fail24 === 1 && openRt === 0
          ? "1 new failure"
          : "New failures need review",
      detail: parts.join(" · "),
      href: "/failures",
    });
  }

  const activeAlerts = (input.alerts ?? []).filter(isActiveAlert);
  activeAlerts.sort((a, b) => {
    const sev =
      severityRank(
        a.severity === "critical"
          ? "critical"
          : a.severity === "warn"
            ? "warn"
            : "info",
      ) -
      severityRank(
        b.severity === "critical"
          ? "critical"
          : b.severity === "warn"
            ? "warn"
            : "info",
      );
    return sev;
  });
  for (const alert of activeAlerts) {
    items.push({
      id: `alert:${alert.id}`,
      kind: alertKind(alert),
      severity:
        alert.severity === "critical"
          ? "critical"
          : alert.severity === "warn"
            ? "warn"
            : "info",
      title: alert.title,
      detail: alert.message,
      href: alertHref(alert),
    });
  }

  const hasPlanItem = items.some((i) => i.kind === "plan-usage");
  const constrained = input.planUsage?.hasFresh
    ? input.planUsage.mostConstrained
    : null;
  if (!hasPlanItem && constrained) {
    const warn =
      input.capacitySettings?.planUsageWarnRemainingPct ??
      DEFAULT_PLAN_USAGE_WARN_REMAINING_PCT;
    const crit =
      input.capacitySettings?.planUsageCriticalRemainingPct ??
      DEFAULT_PLAN_USAGE_CRITICAL_REMAINING_PCT;
    if (warn > 0 && constrained.remainingPercent <= warn) {
      items.push({
        id: `plan:${constrained.provider}:${constrained.windowLabel}`,
        kind: "plan-usage",
        severity:
          crit > 0 && constrained.remainingPercent <= crit
            ? "critical"
            : "warn",
        title: `${constrained.displayName} ${constrained.windowLabel} window is low`,
        detail: `${constrained.remainingPercent}% remaining · not dollars`,
        href: "/consumption?view=direct-api#capacity",
      });
    }
  }

  const hasBudgetItem = items.some((i) => i.kind === "budget");
  const budget = input.budget;
  if (
    !hasBudgetItem &&
    budget?.monthlyBudgetUsd != null &&
    budget.consumedPct != null &&
    budget.consumedPct >= 80
  ) {
    items.push({
      id: "budget:account",
      kind: "budget",
      severity: budget.consumedPct >= 100 ? "critical" : "warn",
      title:
        budget.consumedPct >= 100
          ? "Monthly budget exceeded"
          : "Monthly budget at risk",
      detail: `${Math.round(budget.consumedPct)}% of ${formatUsd(budget.monthlyBudgetUsd)} used (${formatUsd(budget.consumedUsd)})`,
      href: "/consumption?view=direct-api",
    });
  }

  for (const sb of input.scopedBudgets ?? []) {
    if (!sb.enabled || sb.status === "ok") continue;
    if (items.some((i) => i.id === `budget:${sb.id}`)) continue;
    items.push({
      id: `budget:${sb.id}`,
      kind: "budget",
      severity: sb.status === "critical" ? "critical" : "warn",
      title: `${sb.scopeType} ${sb.scopeKey} budget ${sb.status}`,
      detail: `${Math.round(sb.consumedPct)}% of ${formatUsd(sb.monthlyBudgetUsd)} used`,
      href: "/consumption?view=direct-api",
    });
  }

  const hasAnomaly = items.some((i) => i.kind === "anomaly");
  if (!hasAnomaly) {
    const anomaly = (input.anomalies ?? [])[0];
    if (anomaly) {
      items.push({
        id: `anomaly:${anomaly.kind}:${anomaly.day}:${anomaly.provider ?? ""}:${anomaly.model ?? ""}`,
        kind: "anomaly",
        severity: "warn",
        title: "Unusual spend detected",
        detail: anomaly.message,
        href: "/consumption?view=direct-api",
      });
    }
  }

  const mover = (input.topBreakdown ?? [])
    .filter(
      (row) =>
        row.deltaUsd >= SPEND_MOVER_MIN_DELTA_USD &&
        (row.deltaPct ?? 0) >= SPEND_MOVER_MIN_DELTA_PCT,
    )
    .sort((a, b) => b.deltaUsd - a.deltaUsd)[0];
  if (mover) {
    const pct =
      mover.deltaPct != null ? `${Math.round(mover.deltaPct)}%` : "n/a";
    items.push({
      id: `mover:${mover.provider}:${mover.model}`,
      kind: "spend-mover",
      severity: "info",
      title: `${mover.provider} ${mover.model} spend jumped`,
      detail: `+${formatUsd(mover.deltaUsd)} (${pct}) vs prior period`,
      href: "/consumption?view=direct-api",
    });
  }

  const rec = (input.recommendations ?? [])[0];
  if (rec && items.filter((i) => i.severity !== "info").length < 3) {
    items.push({
      id: `rec:${rec.kind}`,
      kind: "spend-mover",
      severity: "info",
      title: rec.title,
      detail: rec.message,
      href: resolveAttentionHref(rec.hrefHint),
    });
  }

  return items
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
    .slice(0, MAX_ITEMS);
}
