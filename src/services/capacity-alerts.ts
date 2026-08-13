/**
 * BSH-141: Plan-usage (quota) and wallet capacity threshold alerts.
 *
 * Distinct from Direct API Spend (cost-class) alerts. Never fire against
 * stale/expired snapshots — reuse evaluateCreditFreshness via rowToApiCredit.
 * Copy is explicit about quota/wallet capacity, not spend.
 */

import type { Database as SqliteDatabase } from "sqlite";
import {
  getCapacityAlertConfig,
  getProviderBudgetConfig,
  type CapacityAlertConfig,
} from "../db/queries/app-settings.js";
function monthKeyInTimeZone(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).format(now); // YYYY-MM
}
import {
  latestProviderCreditSnapshots,
  rowToApiCredit,
} from "../db/queries/provider-credits.js";
import {
  listSpendAlerts,
  upsertSpendAlertByFingerprint,
  type SpendAlert,
  type SpendAlertDataClass,
  type SpendAlertSeverity,
} from "../db/queries/spend-alerts.js";

export interface CapacityCreditInput {
  provider: string;
  label: string;
  remaining: number | null;
  unit: string;
  status: string;
  surface: string;
  asOf: string;
  details?: Record<string, unknown> | null;
}

export interface CapacityAlertCandidate {
  kind: "threshold";
  dataClass: Exclude<SpendAlertDataClass, "cost">;
  severity: SpendAlertSeverity;
  scopeType: "quota" | "wallet";
  scopeKey: string;
  title: string;
  message: string;
  evidence: Record<string, unknown>;
  fingerprint: string;
  monthKey: string;
}

function formatWindowMinutes(minutes: unknown): string | null {
  const n =
    typeof minutes === "number"
      ? minutes
      : typeof minutes === "string"
        ? Number(minutes)
        : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n === 300) return "5h";
  if (n === 10080) return "7-day";
  if (n % 1440 === 0) return `${n / 1440}-day`;
  if (n % 60 === 0) return `${n / 60}h`;
  return `${n}m`;
}

function titleCaseToken(raw: string): string {
  if (!raw) return raw;
  if (raw.toLowerCase() === "claude") return "Claude";
  if (raw.toLowerCase() === "codex") return "Codex";
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/** Human window name for titles; never implies dollars. */
export function displayCapacityWindowName(
  label: string,
  details?: Record<string, unknown> | null,
): string {
  const limitId =
    typeof details?.limitId === "string" && details.limitId.trim() !== ""
      ? details.limitId
      : null;
  const fromLabel = label.replace(/^quota_/, "").replace(/_\d+m$/i, "");
  const raw = limitId ?? fromLabel;
  const pretty = raw
    .split(/[:_]/)
    .filter(Boolean)
    .map(titleCaseToken)
    .join(" ");
  const window = formatWindowMinutes(details?.windowMinutes);
  if (
    pretty &&
    window &&
    !pretty.toLowerCase().includes(window.toLowerCase())
  ) {
    return `${pretty} (${window})`;
  }
  return pretty || label;
}

function windowKey(credit: CapacityCreditInput): string {
  const resetsAt = credit.details?.resetsAt;
  if (typeof resetsAt === "string" && resetsAt.trim() !== "") {
    return resetsAt.slice(0, 10);
  }
  return credit.asOf.slice(0, 10);
}

function providerDisplay(provider: string): string {
  if (provider === "anthropic") return "Anthropic";
  if (provider === "openai") return "OpenAI";
  if (provider === "openrouter") return "OpenRouter";
  if (provider === "xai") return "xAI";
  return provider;
}

function crossedSeverity(
  remaining: number,
  warnAt: number,
  criticalAt: number,
): SpendAlertSeverity | null {
  if (criticalAt > 0 && remaining <= criticalAt) return "critical";
  if (warnAt > 0 && remaining <= warnAt) return "warn";
  return null;
}

export function evaluateCapacityAlerts(input: {
  credits: CapacityCreditInput[];
  thresholds: CapacityAlertConfig;
  monthKey: string;
}): CapacityAlertCandidate[] {
  const { credits, thresholds, monthKey } = input;
  const out: CapacityAlertCandidate[] = [];

  for (const credit of credits) {
    if (credit.status !== "ok") continue;
    if (credit.remaining == null || !Number.isFinite(credit.remaining)) {
      continue;
    }

    const remaining = credit.remaining;
    const scopeKey = `${credit.provider}:${credit.label}`;

    if (credit.surface === "plan_usage") {
      const severity = crossedSeverity(
        remaining,
        thresholds.planUsageWarnRemainingPct,
        thresholds.planUsageCriticalRemainingPct,
      );
      if (!severity) continue;
      const windowName = displayCapacityWindowName(
        credit.label,
        credit.details,
      );
      const threshold =
        severity === "critical"
          ? thresholds.planUsageCriticalRemainingPct
          : thresholds.planUsageWarnRemainingPct;
      const title = `Plan capacity ${severity}: ${windowName}`;
      const message = `${providerDisplay(credit.provider)} ${windowName} plan-usage window has ${remaining.toFixed(1)}% remaining (${severity} at ≤${threshold}%). This is a subscription quota alert, not Direct API Spend.`;
      out.push({
        kind: "threshold",
        dataClass: "quota",
        severity,
        scopeType: "quota",
        scopeKey,
        title,
        message,
        evidence: {
          dataClass: "quota",
          provider: credit.provider,
          label: credit.label,
          remainingPct: remaining,
          unit: credit.unit,
          warnRemainingPct: thresholds.planUsageWarnRemainingPct,
          criticalRemainingPct: thresholds.planUsageCriticalRemainingPct,
          windowKey: windowKey(credit),
          asOf: credit.asOf,
        },
        fingerprint: `quota_threshold:${credit.provider}:${credit.label}:${windowKey(credit)}:${severity}`,
        monthKey,
      });
      continue;
    }

    if (credit.surface === "wallet") {
      const severity = crossedSeverity(
        remaining,
        thresholds.walletWarnRemainingUsd,
        thresholds.walletCriticalRemainingUsd,
      );
      if (!severity) continue;
      const walletName =
        credit.label === "prepaid_balance"
          ? "prepaid balance"
          : credit.label.replace(/_/g, " ");
      const threshold =
        severity === "critical"
          ? thresholds.walletCriticalRemainingUsd
          : thresholds.walletWarnRemainingUsd;
      const title = `Wallet capacity ${severity}: ${providerDisplay(credit.provider)} ${walletName}`;
      const message = `${providerDisplay(credit.provider)} prepaid wallet has $${remaining.toFixed(2)} remaining (${severity} at ≤$${threshold.toFixed(2)}). This is a prepaid credit alert, not Direct API Spend.`;
      out.push({
        kind: "threshold",
        dataClass: "wallet",
        severity,
        scopeType: "wallet",
        scopeKey,
        title,
        message,
        evidence: {
          dataClass: "wallet",
          provider: credit.provider,
          label: credit.label,
          remainingUsd: remaining,
          unit: credit.unit,
          warnRemainingUsd: thresholds.walletWarnRemainingUsd,
          criticalRemainingUsd: thresholds.walletCriticalRemainingUsd,
          asOf: credit.asOf,
        },
        fingerprint: `wallet_threshold:${credit.provider}:${credit.label}:${monthKey}:${severity}`,
        monthKey,
      });
    }
  }

  return out;
}

/** Load latest credits, evaluate freshness, persist quota/wallet threshold alerts. */
export async function persistCapacityAlerts(
  db: SqliteDatabase,
  opts: { now?: Date; monthKey?: string } = {},
): Promise<SpendAlert[]> {
  const now = opts.now ?? new Date();
  const [rows, thresholds, budget] = await Promise.all([
    latestProviderCreditSnapshots(db),
    getCapacityAlertConfig(db),
    opts.monthKey ? Promise.resolve(null) : getProviderBudgetConfig(db),
  ]);
  const monthKey =
    opts.monthKey ?? monthKeyInTimeZone(now, budget?.timezone ?? "UTC");
  const credits: CapacityCreditInput[] = rows.map((row) => {
    const api = rowToApiCredit(row, now);
    return {
      provider: api.provider,
      label: api.label,
      remaining: api.remaining,
      unit: String(api.unit),
      status: String(api.status),
      surface: api.surface,
      asOf: api.asOf,
      details: api.details,
    };
  });

  const candidates = evaluateCapacityAlerts({
    credits,
    thresholds,
    monthKey,
  });

  for (const c of candidates) {
    await upsertSpendAlertByFingerprint(db, {
      kind: c.kind,
      severity: c.severity,
      dataClass: c.dataClass,
      scopeType: c.scopeType,
      scopeKey: c.scopeKey,
      title: c.title,
      message: c.message,
      evidence: c.evidence,
      estimatedImpactUsd: null,
      fingerprint: c.fingerprint,
      monthKey: c.monthKey,
      autoDeliver: true,
    });
  }

  return listSpendAlerts(db, { limit: 50, monthKey });
}
