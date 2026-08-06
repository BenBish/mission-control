/**
 * Provider spend insights: budget progress, burn rate, month-end forecast,
 * daily trends with prior-period comparison, anomaly detection, efficiency
 * metrics, scoped budgets, optimization signals, and alert history (BSH-105).
 *
 * Actual provider spend (provider_usage_daily) is never summed with agent-
 * attributed session costs, allocated subscription capacity, or estimated
 * local-compute / cache-savings figures.
 *
 * Timezone / partial-data / forecast contract (surfaced in response meta):
 * - Month boundaries use the configured IANA timezone (default UTC).
 * - Day keys in storage are YYYY-MM-DD as reported by provider APIs; we
 *   treat them as calendar days in the budget timezone for MTD windows.
 * - Forecast methods: simple_mtd (default, backward-compat), trailing_7d,
 *   weighted_recency. Incomplete days (today + billing-lag window) are
 *   labeled and optionally excluded from burn; confidence range is reported.
 * - Delayed provider finalization can understate MTD; when any *observed*
 *   connector is error/stale, or when there is no usable sync/usage signal,
 *   forecastReliable is false.
 */

import type { Database as SqliteDatabase } from "sqlite";
import {
  getProviderBudgetConfig,
  type ProviderBudgetConfig,
} from "../db/queries/app-settings.js";
import {
  getProviderUsage,
  listProviderSyncStatus,
  type ProviderUsageRow,
  type ProviderSyncStatusRow,
} from "../db/queries/provider-usage.js";
import { listAgentUsageFacts } from "../db/queries/agent-usage.js";
import {
  listSpendBudgets,
  type SpendBudget,
} from "../db/queries/spend-budgets.js";
import {
  listSpendAlerts,
  upsertSpendAlertByFingerprint,
  type SpendAlert,
} from "../db/queries/spend-alerts.js";
import { credentialMeta, getConnectors } from "./provider-connectors/index.js";
import {
  applyFailureWaste,
  buildFeeCategories,
  computeAgentEfficiency,
  computeProviderEfficiency,
  generateOptimizationRecommendations,
  type EfficiencySlice,
  type FeeCategoryBreakdown,
  type OptimizationRecommendation,
} from "./cost-efficiency.js";

/** Stale if last success older than this (ms). Default 36h. */
export const SYNC_STALE_MS = 36 * 60 * 60 * 1000;

/** Rolling window for anomaly baseline (days before the evaluated day). */
export const ANOMALY_BASELINE_DAYS = 7;

/** Flag only when spend ≥ multiplier × baseline. */
export const ANOMALY_MULTIPLIER = 2;

/** Absolute floor so tiny noise does not flag. */
export const ANOMALY_MIN_USD = 1;

/**
 * Require this many non-zero baseline days before flagging a spike.
 * Avoids noisy “first day of data” anomalies without a real baseline.
 */
export const ANOMALY_MIN_BASELINE_SAMPLES = 3;

/** Days of recent provider billing still considered incomplete (lag). */
export const DEFAULT_BILLING_LAG_DAYS = 2;

/** Trailing window for trailing_7d forecast method. */
export const TRAILING_FORECAST_DAYS = 7;

export interface DailySpendPoint {
  day: string;
  costUsd: number;
  priorPeriodCostUsd: number | null;
  deltaUsd: number | null;
  deltaPct: number | null;
}

export interface BreakdownCompareRow {
  provider: string;
  model: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  priorPeriodCostUsd: number;
  deltaUsd: number;
  deltaPct: number | null;
}

export interface SpendAnomaly {
  kind: "daily" | "provider_model";
  day: string;
  provider: string | null;
  model: string | null;
  valueUsd: number;
  baselineUsd: number;
  ratio: number;
  message: string;
}

export type SyncWarningReason =
  | "error"
  | "stale"
  | "not_configured"
  | "limited"
  /** No configured connectors and no usable sync history to trust. */
  | "no_sync_data";

export interface SyncWarning {
  /** Connector id, or `*` for account-level warnings (e.g. no_sync_data). */
  provider: string;
  status: string;
  reason: SyncWarningReason;
  lastSuccessAt: string | null;
  lastError: string | null;
}

export type ForecastMethod = "simple_mtd" | "trailing_7d" | "weighted_recency";

export interface ForecastDetail {
  method: ForecastMethod;
  /** Primary point forecast (month-end USD). */
  pointUsd: number;
  /** Lower bound of confidence range. */
  lowUsd: number;
  /** Upper bound of confidence range. */
  highUsd: number;
  /** 0–1 confidence score (also drives forecastReliable when low). */
  confidence: number;
  /** Days used for burn calculation after incomplete-day treatment. */
  daysUsed: number;
  /** Calendar days elapsed in month (including today). */
  daysElapsed: number;
  daysInMonth: number;
  incompleteDays: string[];
  incompleteDayTreatment: "excluded_from_burn" | "included_labeled";
  billingLagDays: number;
  windowStart: string;
  windowEnd: string;
  notes: string[];
}

export interface ScopedBudgetProgress {
  id: string;
  scopeType: SpendBudget["scopeType"];
  scopeKey: string;
  monthlyBudgetUsd: number;
  consumedUsd: number;
  remainingUsd: number;
  consumedPct: number;
  warnThresholdPct: number;
  criticalThresholdPct: number;
  status: "ok" | "warn" | "critical";
  enabled: boolean;
}

export interface SpendInsightsMeta {
  source: "provider-api";
  timezone: string;
  monthStart: string;
  monthEnd: string;
  today: string;
  daysElapsed: number;
  daysInMonth: number;
  partialMonth: boolean;
  forecastReliable: boolean;
  /** Billing lag assumed when labeling incomplete days. */
  billingLagDays: number;
  incompleteDays: string[];
  forecastMethod: ForecastMethod;
  notes: string[];
}

export interface SpendInsights {
  budget: {
    monthlyBudgetUsd: number | null;
    consumedUsd: number;
    remainingUsd: number | null;
    consumedPct: number | null;
  };
  /** Scoped budgets with MTD progress (actual provider spend only). */
  scopedBudgets: ScopedBudgetProgress[];
  burnRateUsdPerDay: number;
  forecastMonthEndUsd: number;
  /** Rich forecast contract (method, confidence, incomplete days, lag). */
  forecast: ForecastDetail;
  dailyTrend: DailySpendPoint[];
  topBreakdown: BreakdownCompareRow[];
  anomalies: SpendAnomaly[];
  syncWarnings: SyncWarning[];
  /** Unit economics by provider/model (actual) and project (agent). */
  efficiency: {
    provider: EfficiencySlice[];
    agent: EfficiencySlice[];
  };
  feeCategories: FeeCategoryBreakdown;
  recommendations: OptimizationRecommendation[];
  /** Recent alert delivery history (threshold + anomaly). */
  alerts: SpendAlert[];
  meta: SpendInsightsMeta;
}

export interface ComputeInsightsInput {
  usage: ProviderUsageRow[];
  syncStatus: ProviderSyncStatusRow[];
  configuredProviderIds: string[];
  budget: ProviderBudgetConfig;
  now?: Date;
  staleMs?: number;
  billingLagDays?: number;
  forecastMethod?: ForecastMethod;
  /** When true, incomplete days still count in simple_mtd burn (legacy). */
  includeIncompleteInBurn?: boolean;
  scopedBudgets?: SpendBudget[];
  agentFacts?: import("../db/queries/agent-usage.js").AgentUsageFactRow[];
  failureWasteUsd?: number | null;
  successfulSessionCount?: number | null;
  totalSessionsWithCost?: number | null;
  localModelKeys?: string[];
  existingAlerts?: SpendAlert[];
}

/** Format a Date as YYYY-MM-DD in the given IANA timezone. */
export function formatDayInTimeZone(date: Date, timeZone: string): string {
  // en-CA yields YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function parseDay(day: string): {
  year: number;
  month: number;
  day: number;
} {
  const [y, m, d] = day.split("-").map(Number);
  return { year: y, month: m, day: d };
}

export function daysInCalendarMonth(year: number, month: number): number {
  // month is 1-12; Date day 0 of next month = last day of this month
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function addDays(day: string, delta: number): string {
  const { year, month, day: d } = parseDay(day);
  const dt = new Date(Date.UTC(year, month - 1, d + delta));
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export function listDaysInclusive(start: string, end: string): string[] {
  if (start > end) return [];
  const out: string[] = [];
  let cur = start;
  while (cur <= end) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

function sumCost(rows: ProviderUsageRow[]): number {
  let total = 0;
  for (const r of rows) {
    if (r.cost_usd != null) total += r.cost_usd;
  }
  return total;
}

function dailyTotals(rows: ProviderUsageRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of rows) {
    const prev = map.get(r.day) ?? 0;
    map.set(r.day, prev + (r.cost_usd ?? 0));
  }
  return map;
}

function providerModelDayTotals(rows: ProviderUsageRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of rows) {
    const key = `${r.day}\0${r.provider}\0${r.model}`;
    map.set(key, (map.get(key) ?? 0) + (r.cost_usd ?? 0));
  }
  return map;
}

function meanOf(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function pctDelta(current: number, prior: number): number | null {
  if (prior === 0) return current === 0 ? 0 : null;
  return ((current - prior) / prior) * 100;
}

function toIsoMaybe(sqliteTimestamp: string | null): string | null {
  if (!sqliteTimestamp) return null;
  return sqliteTimestamp.includes("T")
    ? sqliteTimestamp
    : `${sqliteTimestamp.replace(" ", "T")}Z`;
}

/**
 * Providers we can use for forecast reliability:
 * - currently configured (env credentials present), or
 * - have sync history (last_success_at or a non-idle status).
 * Env-only not_configured without history is awareness only.
 */
function isObservedProvider(
  id: string,
  configured: Set<string>,
  row: ProviderSyncStatusRow | undefined,
): boolean {
  if (configured.has(id)) return true;
  if (!row) return false;
  if (row.last_success_at) return true;
  return (
    row.status === "ok" ||
    row.status === "error" ||
    row.status === "limited" ||
    row.status === "syncing"
  );
}

export function evaluateSyncWarnings(
  syncStatus: ProviderSyncStatusRow[],
  configuredProviderIds: string[],
  now: Date,
  staleMs: number,
): { warnings: SyncWarning[]; forecastReliable: boolean } {
  const configured = new Set(configuredProviderIds);
  const byId = new Map(syncStatus.map((r) => [r.provider, r]));
  const warnings: SyncWarning[] = [];
  let forecastReliable = true;
  let observedCount = 0;
  let healthyObserved = 0;

  const allIds = new Set<string>([
    ...configured,
    ...syncStatus.map((r) => r.provider),
    ...getConnectors().map((c) => c.id),
  ]);

  for (const id of allIds) {
    const row = byId.get(id);
    const isConfigured = configured.has(id);
    const observed = isObservedProvider(id, configured, row);

    if (!observed) {
      if (!isConfigured) {
        warnings.push({
          provider: id,
          status: "not_configured",
          reason: "not_configured",
          lastSuccessAt: null,
          lastError: null,
        });
      }
      continue;
    }

    observedCount += 1;
    const status = row?.status ?? (isConfigured ? "unknown" : "unknown");
    const lastSuccessIso = toIsoMaybe(row?.last_success_at ?? null);
    const lastSuccessMs = lastSuccessIso
      ? new Date(lastSuccessIso).getTime()
      : null;
    const isStale =
      lastSuccessMs == null ||
      Number.isNaN(lastSuccessMs) ||
      now.getTime() - lastSuccessMs > staleMs;

    if (status === "error") {
      warnings.push({
        provider: id,
        status,
        reason: "error",
        lastSuccessAt: lastSuccessIso,
        lastError: row?.last_error ?? null,
      });
      forecastReliable = false;
    } else if (isStale) {
      warnings.push({
        provider: id,
        status: status || "unknown",
        reason: "stale",
        lastSuccessAt: lastSuccessIso,
        lastError: row?.last_error ?? null,
      });
      forecastReliable = false;
    } else if (status === "limited") {
      warnings.push({
        provider: id,
        status,
        reason: "limited",
        lastSuccessAt: lastSuccessIso,
        lastError: row?.last_error ?? null,
      });
      healthyObserved += 1;
      // limited still has data — do not kill forecast reliability alone
    } else {
      healthyObserved += 1;
    }

    // Still note missing credentials for operators who cannot re-sync
    if (!isConfigured) {
      warnings.push({
        provider: id,
        status: "not_configured",
        reason: "not_configured",
        lastSuccessAt: lastSuccessIso,
        lastError: null,
      });
    }
  }

  // No observed connectors at all → cannot trust a forecast
  if (observedCount === 0) {
    forecastReliable = false;
    warnings.unshift({
      provider: "*",
      status: "unknown",
      reason: "no_sync_data",
      lastSuccessAt: null,
      lastError: null,
    });
  } else if (healthyObserved === 0) {
    // All observed are error/stale — already marked unreliable above
    forecastReliable = false;
  }

  return { warnings, forecastReliable };
}

export function detectAnomalies(
  usage: ProviderUsageRow[],
  monthStart: string,
  today: string,
): SpendAnomaly[] {
  const dayTotals = dailyTotals(usage);
  const pmTotals = providerModelDayTotals(usage);
  const anomalies: SpendAnomaly[] = [];

  // Need history before month for baseline; use full usage map
  const allDays = [...dayTotals.keys()].sort();
  if (allDays.length === 0) return [];

  const minDay = allDays[0];
  const evalDays = listDaysInclusive(monthStart, today);

  for (const day of evalDays) {
    const value = dayTotals.get(day) ?? 0;
    if (value < ANOMALY_MIN_USD) continue;

    const baselineDays: number[] = [];
    for (let i = 1; i <= ANOMALY_BASELINE_DAYS; i++) {
      const d = addDays(day, -i);
      if (d < minDay) continue;
      baselineDays.push(dayTotals.get(d) ?? 0);
    }
    const nonzeroSamples = baselineDays.filter((v) => v > 0).length;
    if (nonzeroSamples < ANOMALY_MIN_BASELINE_SAMPLES) continue;
    const baseline = meanOf(baselineDays);
    if (baseline <= 0) continue;
    const ratio = value / baseline;
    if (ratio >= ANOMALY_MULTIPLIER) {
      anomalies.push({
        kind: "daily",
        day,
        provider: null,
        model: null,
        valueUsd: value,
        baselineUsd: baseline,
        ratio,
        message: `Daily spend $${value.toFixed(2)} is ${ratio.toFixed(1)}× the 7-day baseline ($${baseline.toFixed(2)})`,
      });
    }
  }

  // Provider/model day spikes within MTD
  const seenPm = new Set<string>();
  for (const r of usage) {
    if (r.day < monthStart || r.day > today) continue;
    const key = `${r.day}\0${r.provider}\0${r.model}`;
    if (seenPm.has(key)) continue;
    seenPm.add(key);
    const value = pmTotals.get(key) ?? 0;
    if (value < ANOMALY_MIN_USD) continue;

    const baselineDays: number[] = [];
    for (let i = 1; i <= ANOMALY_BASELINE_DAYS; i++) {
      const d = addDays(r.day, -i);
      baselineDays.push(pmTotals.get(`${d}\0${r.provider}\0${r.model}`) ?? 0);
    }
    const nonzeroSamples = baselineDays.filter((v) => v > 0).length;
    if (nonzeroSamples < ANOMALY_MIN_BASELINE_SAMPLES) continue;
    const baseline = meanOf(baselineDays);
    if (baseline <= 0) continue;
    const ratio = value / baseline;
    if (ratio >= ANOMALY_MULTIPLIER) {
      anomalies.push({
        kind: "provider_model",
        day: r.day,
        provider: r.provider,
        model: r.model,
        valueUsd: value,
        baselineUsd: baseline,
        ratio,
        message: `${r.provider}/${r.model} spent $${value.toFixed(2)} on ${r.day} (${ratio.toFixed(1)}× 7-day baseline $${baseline.toFixed(2)})`,
      });
    }
  }

  // Highest ratio first, cap list
  anomalies.sort((a, b) => {
    const ra = Number.isFinite(a.ratio) ? a.ratio : 1e9;
    const rb = Number.isFinite(b.ratio) ? b.ratio : 1e9;
    return rb - ra;
  });
  return anomalies.slice(0, 20);
}

/**
 * Label incomplete calendar days: today always incomplete; also the last
 * `billingLagDays` full days may still be revised by providers.
 */
export function incompleteDaysFor(
  monthStart: string,
  today: string,
  billingLagDays: number,
): string[] {
  const lag = Math.max(0, Math.floor(billingLagDays));
  const set = new Set<string>();
  set.add(today);
  for (let i = 1; i <= lag; i++) {
    const d = addDays(today, -i);
    if (d >= monthStart) set.add(d);
  }
  return [...set].sort();
}

export function computeForecast(opts: {
  dayTotals: Map<string, number>;
  monthStart: string;
  today: string;
  daysInMonth: number;
  daysElapsed: number;
  incompleteDays: string[];
  billingLagDays: number;
  method: ForecastMethod;
  /** Exclude incomplete days from burn (recommended). */
  excludeIncompleteFromBurn: boolean;
  forecastReliableFromSync: boolean;
}): ForecastDetail {
  const {
    dayTotals,
    monthStart,
    today,
    daysInMonth,
    daysElapsed,
    incompleteDays,
    billingLagDays,
    method,
    excludeIncompleteFromBurn,
    forecastReliableFromSync,
  } = opts;

  const incomplete = new Set(incompleteDays);
  const allMtdDays = listDaysInclusive(monthStart, today);

  const completeDays = allMtdDays.filter((d) => !incomplete.has(d));
  const burnDays = excludeIncompleteFromBurn ? completeDays : allMtdDays;

  const sumDays = (days: string[]) =>
    days.reduce((acc, d) => acc + (dayTotals.get(d) ?? 0), 0);

  let burnRate = 0;
  let daysUsed = 0;
  let windowStart = monthStart;
  let windowEnd = today;
  const notes: string[] = [];

  if (method === "trailing_7d") {
    const trailStart = addDays(today, -(TRAILING_FORECAST_DAYS - 1));
    const trailDays = listDaysInclusive(
      trailStart < monthStart ? monthStart : trailStart,
      today,
    ).filter((d) => (excludeIncompleteFromBurn ? !incomplete.has(d) : true));
    daysUsed = trailDays.length;
    windowStart = trailDays[0] ?? today;
    windowEnd = trailDays[trailDays.length - 1] ?? today;
    burnRate = daysUsed > 0 ? sumDays(trailDays) / daysUsed : 0;
    notes.push(
      `Trailing ${TRAILING_FORECAST_DAYS}-day burn over ${daysUsed} day(s) ${excludeIncompleteFromBurn ? "(incomplete days excluded)" : "(incomplete days included)"}.`,
    );
  } else if (method === "weighted_recency") {
    // Linear weights: older days weight 1..n for complete burn days
    const days = burnDays;
    daysUsed = days.length;
    windowStart = days[0] ?? monthStart;
    windowEnd = days[days.length - 1] ?? today;
    let weightSum = 0;
    let weighted = 0;
    days.forEach((d, i) => {
      const w = i + 1;
      weighted += (dayTotals.get(d) ?? 0) * w;
      weightSum += w;
    });
    burnRate = weightSum > 0 ? weighted / weightSum : 0;
    notes.push(
      `Weighted-recency burn over ${daysUsed} day(s); newer complete days weigh more.`,
    );
  } else {
    // simple_mtd
    daysUsed = burnDays.length > 0 ? burnDays.length : daysElapsed;
    windowStart = burnDays[0] ?? monthStart;
    windowEnd = burnDays[burnDays.length - 1] ?? today;
    const spent = sumDays(burnDays);
    // If excluding incomplete, still account remaining incomplete days as 0 contribution to spent
    burnRate = daysUsed > 0 ? spent / daysUsed : 0;
    notes.push(
      excludeIncompleteFromBurn
        ? `Simple MTD burn = complete-day spend ÷ ${daysUsed} complete day(s); incomplete days labeled but excluded from burn.`
        : `Simple MTD burn = MTD spend ÷ ${daysUsed} elapsed day(s) (legacy; includes incomplete days).`,
    );
  }

  // Point forecast: spent so far (all MTD including incomplete observed) + burn × remaining full days
  const mtdSpent = sumDays(allMtdDays);
  const remainingDays = Math.max(0, daysInMonth - daysElapsed);
  // For incomplete days already in MTD, treat their observed value as partial;
  // remaining calendar days after today use full burn.
  const pointUsd = mtdSpent + burnRate * remainingDays;

  // Confidence: shrinks with sparse complete days, partial month, lag, sync issues
  let confidence = 0.85;
  if (daysUsed < 3) confidence -= 0.25;
  else if (daysUsed < 7) confidence -= 0.1;
  if (daysElapsed < 5) confidence -= 0.15;
  if (incompleteDays.length > 0)
    confidence -= 0.04 * Math.min(3, incompleteDays.length);
  if (billingLagDays > 0) confidence -= 0.02 * Math.min(3, billingLagDays);
  if (!forecastReliableFromSync) confidence -= 0.25;
  // Variance band from days with actual spend (zeros from no-usage days are normal)
  const sample = burnDays.map((d) => dayTotals.get(d) ?? 0);
  const nonzero = sample.filter((v) => v > 0);
  if (nonzero.length === 0) confidence -= 0.3;
  else if (nonzero.length < 3) confidence -= 0.12;
  else if (nonzero.length < 7) confidence -= 0.04;
  const mean =
    nonzero.length > 0
      ? nonzero.reduce((a, b) => a + b, 0) / nonzero.length
      : 0;
  const variance =
    nonzero.length > 1
      ? nonzero.reduce((a, v) => a + (v - mean) ** 2, 0) / (nonzero.length - 1)
      : 0;
  const std = Math.sqrt(Math.max(0, variance));
  if (mean > 0 && std / mean > 1.5) confidence -= 0.08;
  confidence = Math.max(0.05, Math.min(0.95, confidence));

  const band =
    Math.max(burnRate * 0.5, std, mean * 0.2) *
    Math.sqrt(Math.max(1, remainingDays));
  const lowUsd = Math.max(mtdSpent, pointUsd - band * (1.5 - confidence));
  const highUsd = pointUsd + band * (1.5 - confidence);

  notes.push(
    `Incomplete days: ${incompleteDays.length ? incompleteDays.join(", ") : "none"} (today + ${billingLagDays}-day billing lag).`,
  );
  notes.push(
    `Confidence ${(confidence * 100).toFixed(0)}% — range $${lowUsd.toFixed(2)}–$${highUsd.toFixed(2)}.`,
  );
  if (!forecastReliableFromSync) {
    notes.push("Sync reliability low; treat forecast as directional only.");
  }

  return {
    method,
    pointUsd,
    lowUsd,
    highUsd,
    confidence,
    daysUsed,
    daysElapsed,
    daysInMonth,
    incompleteDays: [...incompleteDays],
    incompleteDayTreatment: excludeIncompleteFromBurn
      ? "excluded_from_burn"
      : "included_labeled",
    billingLagDays,
    windowStart,
    windowEnd,
    notes,
  };
}

function consumedForScope(
  mtdRows: ProviderUsageRow[],
  scopeType: SpendBudget["scopeType"],
  scopeKey: string,
  agentProjectCosts?: Map<string, number>,
): number {
  if (scopeType === "account") {
    return sumCost(mtdRows);
  }
  if (scopeType === "provider") {
    return sumCost(mtdRows.filter((r) => r.provider === scopeKey));
  }
  if (scopeType === "model") {
    // scopeKey: "provider/model" or bare model
    return sumCost(
      mtdRows.filter((r) => {
        const full = `${r.provider}/${r.model}`;
        return full === scopeKey || r.model === scopeKey;
      }),
    );
  }
  // project — agent-attributed only; 0 when no agent map
  if (agentProjectCosts) {
    return agentProjectCosts.get(scopeKey) ?? 0;
  }
  return 0;
}

export function evaluateScopedBudgets(
  budgets: SpendBudget[],
  mtdRows: ProviderUsageRow[],
  agentProjectCosts?: Map<string, number>,
): ScopedBudgetProgress[] {
  return budgets.map((b) => {
    const consumedUsd = consumedForScope(
      mtdRows,
      b.scopeType,
      b.scopeKey,
      agentProjectCosts,
    );
    const remainingUsd = b.monthlyBudgetUsd - consumedUsd;
    const consumedPct =
      b.monthlyBudgetUsd === 0
        ? consumedUsd > 0
          ? 100
          : 0
        : (consumedUsd / b.monthlyBudgetUsd) * 100;
    let status: ScopedBudgetProgress["status"] = "ok";
    if (consumedPct >= b.criticalThresholdPct) status = "critical";
    else if (consumedPct >= b.warnThresholdPct) status = "warn";
    return {
      id: b.id,
      scopeType: b.scopeType,
      scopeKey: b.scopeKey,
      monthlyBudgetUsd: b.monthlyBudgetUsd,
      consumedUsd,
      remainingUsd,
      consumedPct,
      warnThresholdPct: b.warnThresholdPct,
      criticalThresholdPct: b.criticalThresholdPct,
      status,
      enabled: b.enabled,
    };
  });
}

/**
 * Pure insights compute. Default forecast method is `simple_mtd` (legacy
 * burn = MTD ÷ elapsed) so unit tests and direct callers stay stable.
 * `loadSpendInsights` / GET `/api/providers/spend-insights` default to
 * `trailing_7d` with incomplete days excluded from burn.
 */
export function computeSpendInsights(
  input: ComputeInsightsInput,
): SpendInsights {
  const now = input.now ?? new Date();
  const staleMs = input.staleMs ?? SYNC_STALE_MS;
  const billingLagDays = input.billingLagDays ?? DEFAULT_BILLING_LAG_DAYS;
  // Pure compute defaults to legacy simple_mtd for backward-compatible tests;
  // loadSpendInsights opts into trailing_7d + incomplete exclusion.
  const forecastMethod = input.forecastMethod ?? "simple_mtd";
  const excludeIncomplete =
    input.includeIncompleteInBurn === undefined
      ? forecastMethod !== "simple_mtd"
      : !input.includeIncompleteInBurn;
  const { timezone, monthlyBudgetUsd } = input.budget;

  const today = formatDayInTimeZone(now, timezone);
  const { year, month } = parseDay(today);
  const daysInMonth = daysInCalendarMonth(year, month);
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const monthEnd = `${year}-${String(month).padStart(2, "0")}-${String(daysInMonth).padStart(2, "0")}`;
  const daysElapsed = parseDay(today).day; // 1..daysInMonth
  const partialMonth = daysElapsed < daysInMonth;

  // Prior period: same day-of-month range in previous calendar month
  const prevMonthDate = new Date(Date.UTC(year, month - 2, 1));
  const prevYear = prevMonthDate.getUTCFullYear();
  const prevMonth = prevMonthDate.getUTCMonth() + 1;
  const prevDaysInMonth = daysInCalendarMonth(prevYear, prevMonth);
  const priorStart = `${prevYear}-${String(prevMonth).padStart(2, "0")}-01`;
  const priorEndDay = Math.min(daysElapsed, prevDaysInMonth);
  const priorEnd = `${prevYear}-${String(prevMonth).padStart(2, "0")}-${String(priorEndDay).padStart(2, "0")}`;

  // Need history for anomaly baselines (look back ~40 days)
  const historyStart = addDays(monthStart, -40);
  const usage = input.usage.filter((r) => r.day >= historyStart);

  const mtdRows = usage.filter((r) => r.day >= monthStart && r.day <= today);
  const priorRows = usage.filter(
    (r) => r.day >= priorStart && r.day <= priorEnd,
  );

  const consumedUsd = sumCost(mtdRows);
  const incompleteDays = incompleteDaysFor(monthStart, today, billingLagDays);
  const dayTotals = dailyTotals(usage);

  const { warnings: syncWarnings, forecastReliable: syncReliable } =
    evaluateSyncWarnings(
      input.syncStatus,
      input.configuredProviderIds,
      now,
      staleMs,
    );

  const forecast = computeForecast({
    dayTotals,
    monthStart,
    today,
    daysInMonth,
    daysElapsed,
    incompleteDays,
    billingLagDays,
    method: forecastMethod,
    excludeIncompleteFromBurn: excludeIncomplete,
    forecastReliableFromSync: syncReliable,
  });

  // Backward-compat fields: burn from forecast, point forecast
  const burnRateUsdPerDay =
    forecast.daysUsed > 0
      ? // reconstruct approx burn for display
        (() => {
          // Prefer forecast method burn: (point - mtd) / remaining, else mtd/elapsed
          const remaining = Math.max(0, daysInMonth - daysElapsed);
          if (remaining > 0) {
            return Math.max(0, (forecast.pointUsd - consumedUsd) / remaining);
          }
          return daysElapsed > 0 ? consumedUsd / daysElapsed : 0;
        })()
      : 0;
  const forecastMonthEndUsd = forecast.pointUsd;
  const forecastReliable =
    syncReliable && forecast.confidence >= 0.35 && forecast.daysUsed >= 1;

  const remainingUsd =
    monthlyBudgetUsd == null ? null : monthlyBudgetUsd - consumedUsd;
  const consumedPct =
    monthlyBudgetUsd == null || monthlyBudgetUsd === 0
      ? null
      : (consumedUsd / monthlyBudgetUsd) * 100;

  // Daily trend for current month (fill zeros)
  const priorDayTotals = dailyTotals(priorRows);
  const priorByDom = new Map<number, number>();
  for (const [day, cost] of priorDayTotals) {
    priorByDom.set(parseDay(day).day, cost);
  }

  const dailyTrend: DailySpendPoint[] = listDaysInclusive(
    monthStart,
    today,
  ).map((day) => {
    const costUsd = dayTotals.get(day) ?? 0;
    const dom = parseDay(day).day;
    const priorPeriodCostUsd = priorByDom.has(dom)
      ? (priorByDom.get(dom) ?? 0)
      : null;
    const deltaUsd =
      priorPeriodCostUsd == null ? null : costUsd - priorPeriodCostUsd;
    const deltaPct =
      priorPeriodCostUsd == null ? null : pctDelta(costUsd, priorPeriodCostUsd);
    return {
      day,
      costUsd,
      priorPeriodCostUsd,
      deltaUsd,
      deltaPct,
    };
  });

  // Breakdown: current MTD vs prior period same DOM range
  type Agg = {
    provider: string;
    model: string;
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
  };
  const mtdAgg = new Map<string, Agg>();
  for (const r of mtdRows) {
    const k = `${r.provider}\0${r.model}`;
    const existing = mtdAgg.get(k) ?? {
      provider: r.provider,
      model: r.model,
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
    existing.costUsd += r.cost_usd ?? 0;
    existing.inputTokens += r.input_tokens;
    existing.outputTokens += r.output_tokens;
    mtdAgg.set(k, existing);
  }
  const priorAgg = new Map<string, number>();
  for (const r of priorRows) {
    const k = `${r.provider}\0${r.model}`;
    priorAgg.set(k, (priorAgg.get(k) ?? 0) + (r.cost_usd ?? 0));
  }

  const topBreakdown: BreakdownCompareRow[] = [...mtdAgg.values()]
    .map((row) => {
      const priorPeriodCostUsd =
        priorAgg.get(`${row.provider}\0${row.model}`) ?? 0;
      return {
        provider: row.provider,
        model: row.model,
        costUsd: row.costUsd,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        priorPeriodCostUsd,
        deltaUsd: row.costUsd - priorPeriodCostUsd,
        deltaPct: pctDelta(row.costUsd, priorPeriodCostUsd),
      };
    })
    .sort((a, b) => b.costUsd - a.costUsd)
    .slice(0, 25);

  const anomalies = detectAnomalies(usage, monthStart, today);

  // Efficiency
  const providerEfficiency = computeProviderEfficiency(mtdRows);
  let agentEfficiency = computeAgentEfficiency(input.agentFacts ?? []);
  agentEfficiency = applyFailureWaste(
    agentEfficiency,
    input.failureWasteUsd ?? null,
    input.successfulSessionCount ?? null,
    input.totalSessionsWithCost ?? null,
  );

  const agentOverall = agentEfficiency.find((s) => s.dimension === "overall");
  const feeCategories = buildFeeCategories({
    actualProviderSpendUsd: consumedUsd,
    agentAttributedCostUsd: agentOverall?.costUsd ?? null,
    estimatedCacheSavingsUsd: agentOverall?.cacheSavingsUsd ?? null,
    failureWasteUsd: agentOverall?.failureWasteUsd ?? null,
  });

  const recommendations = generateOptimizationRecommendations({
    providerEfficiency,
    agentEfficiency,
    anomalies,
    localModelKeys: input.localModelKeys,
  });

  // Project costs for scoped project budgets
  const agentProjectCosts = new Map<string, number>();
  for (const s of agentEfficiency) {
    if (s.dimension === "project" && s.costUsd != null) {
      agentProjectCosts.set(s.key, s.costUsd);
    }
  }

  const scopedBudgets = evaluateScopedBudgets(
    (input.scopedBudgets ?? []).filter((b) => b.enabled),
    mtdRows,
    agentProjectCosts,
  );

  const notes: string[] = [
    "Costs are provider-API billing only; never summed with Agent Usage / session-log costs.",
    `Month window is ${monthStart} → ${monthEnd} in timezone ${timezone}.`,
    `Forecast method=${forecast.method}; incomplete-day treatment=${forecast.incompleteDayTreatment}; billing lag=${billingLagDays}d.`,
    "Prior period compares the same day-of-month range in the previous calendar month.",
    `Anomalies: daily or provider/model spend ≥ ${ANOMALY_MULTIPLIER}× rolling ${ANOMALY_BASELINE_DAYS}-day mean, ≥ $${ANOMALY_MIN_USD}, and ≥ ${ANOMALY_MIN_BASELINE_SAMPLES} non-zero baseline days.`,
    "Actual provider spend, agent-attributed cost, and estimated cache savings are separate fee categories — never visually summed.",
    ...forecast.notes,
  ];
  if (partialMonth) {
    notes.push(
      "Partial month: forecast extrapolates current burn; early-month forecasts are high-variance.",
    );
  }
  if (!forecastReliable) {
    notes.push(
      "Forecast marked unreliable due to stale/error observed syncs, low confidence, or no usable provider sync history.",
    );
  }

  return {
    budget: {
      monthlyBudgetUsd,
      consumedUsd,
      remainingUsd,
      consumedPct,
    },
    scopedBudgets,
    burnRateUsdPerDay,
    forecastMonthEndUsd,
    forecast,
    dailyTrend,
    topBreakdown,
    anomalies,
    syncWarnings,
    efficiency: {
      provider: providerEfficiency,
      agent: agentEfficiency,
    },
    feeCategories,
    recommendations,
    alerts: input.existingAlerts ?? [],
    meta: {
      source: "provider-api",
      timezone,
      monthStart,
      monthEnd,
      today,
      daysElapsed,
      daysInMonth,
      partialMonth,
      forecastReliable,
      billingLagDays,
      incompleteDays,
      forecastMethod,
      notes,
    },
  };
}

/**
 * Persist threshold + anomaly alerts; returns full recent history.
 * Fingerprint + month_key dedupe means repeated page loads are insert-free
 * after the first write for each active condition.
 */
export async function persistInsightAlerts(
  db: SqliteDatabase,
  insights: SpendInsights,
): Promise<SpendAlert[]> {
  const monthKey = insights.meta.monthStart.slice(0, 7); // YYYY-MM

  for (const sb of insights.scopedBudgets) {
    if (sb.status === "ok") continue;
    const severity = sb.status === "critical" ? "critical" : "warn";
    const fingerprint = `threshold:${sb.scopeType}:${sb.scopeKey}:${monthKey}:${sb.status}`;
    await upsertSpendAlertByFingerprint(db, {
      kind: "threshold",
      severity,
      scopeType: sb.scopeType,
      scopeKey: sb.scopeKey,
      title: `Budget ${sb.status}: ${sb.scopeType}/${sb.scopeKey}`,
      message: `${sb.scopeType} ${sb.scopeKey} at ${sb.consumedPct.toFixed(1)}% of $${sb.monthlyBudgetUsd.toFixed(2)} ($${sb.consumedUsd.toFixed(2)} consumed).`,
      evidence: {
        consumedUsd: sb.consumedUsd,
        monthlyBudgetUsd: sb.monthlyBudgetUsd,
        consumedPct: sb.consumedPct,
        status: sb.status,
      },
      estimatedImpactUsd: Math.max(0, sb.consumedUsd - sb.monthlyBudgetUsd),
      fingerprint,
      monthKey,
      autoDeliver: true,
    });
  }

  // Legacy account budget threshold
  if (
    insights.budget.monthlyBudgetUsd != null &&
    insights.budget.consumedPct != null
  ) {
    const pct = insights.budget.consumedPct;
    if (pct >= 80) {
      const status = pct >= 100 ? "critical" : "warn";
      await upsertSpendAlertByFingerprint(db, {
        kind: "threshold",
        severity: status,
        scopeType: "account",
        scopeKey: "*",
        title: `Account budget ${status}`,
        message: `Account Direct API Spend at ${pct.toFixed(1)}% of $${insights.budget.monthlyBudgetUsd.toFixed(2)}.`,
        evidence: {
          consumedUsd: insights.budget.consumedUsd,
          monthlyBudgetUsd: insights.budget.monthlyBudgetUsd,
          consumedPct: pct,
        },
        estimatedImpactUsd: Math.max(
          0,
          insights.budget.consumedUsd - insights.budget.monthlyBudgetUsd,
        ),
        fingerprint: `threshold:account:*:${monthKey}:${status}`,
        monthKey,
        autoDeliver: true,
      });
    }
  }

  for (const a of insights.anomalies.slice(0, 10)) {
    const fingerprint = `anomaly:${a.kind}:${a.day}:${a.provider ?? ""}:${a.model ?? ""}`;
    await upsertSpendAlertByFingerprint(db, {
      kind: "anomaly",
      severity: a.ratio >= 3 ? "critical" : "warn",
      scopeType: a.provider ? "model" : "account",
      scopeKey: a.provider ? `${a.provider}/${a.model ?? ""}` : "*",
      title: a.provider
        ? `Anomaly ${a.provider}/${a.model}`
        : `Daily anomaly ${a.day}`,
      message: a.message,
      evidence: {
        day: a.day,
        valueUsd: a.valueUsd,
        baselineUsd: a.baselineUsd,
        ratio: a.ratio,
        kind: a.kind,
      },
      estimatedImpactUsd: Math.max(0, a.valueUsd - a.baselineUsd),
      fingerprint,
      monthKey,
      autoDeliver: true,
    });
  }

  return listSpendAlerts(db, { limit: 50, monthKey });
}

/** Load usage + sync + budget + agent facts from DB and compute insights. */
export async function loadSpendInsights(
  db: SqliteDatabase,
  opts: {
    now?: Date;
    forecastMethod?: ForecastMethod;
    billingLagDays?: number;
    persistAlerts?: boolean;
  } = {},
): Promise<SpendInsights> {
  const budget = await getProviderBudgetConfig(db);
  const now = opts.now ?? new Date();
  const today = formatDayInTimeZone(now, budget.timezone);
  const { year, month } = parseDay(today);
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  // History for baselines + prior month
  const since = addDays(monthStart, -45);
  const monthStartIso = `${monthStart}T00:00:00.000Z`;

  const [usage, syncStatus, scopedBudgets, agentFacts, sessionOutcome] =
    await Promise.all([
      getProviderUsage(db, { since }),
      listProviderSyncStatus(db),
      listSpendBudgets(db, { enabledOnly: false }),
      listAgentUsageFacts(db, { since: monthStartIso }),
      loadSessionOutcomeStats(db, monthStartIso),
    ]);

  const configuredProviderIds = getConnectors()
    .filter((c) => credentialMeta(c.id).configured)
    .map((c) => c.id);

  // Local $0 models from static pricing keys is optional; leave empty by default
  const insights = computeSpendInsights({
    usage,
    syncStatus,
    configuredProviderIds,
    budget,
    now,
    forecastMethod: opts.forecastMethod ?? "trailing_7d",
    billingLagDays: opts.billingLagDays ?? DEFAULT_BILLING_LAG_DAYS,
    scopedBudgets,
    agentFacts,
    failureWasteUsd: sessionOutcome.failureWasteUsd,
    successfulSessionCount: sessionOutcome.successfulSessionCount,
    totalSessionsWithCost: sessionOutcome.totalSessionsWithCost,
  });

  if (opts.persistAlerts === false) {
    return insights;
  }

  const alerts = await persistInsightAlerts(db, insights);
  return { ...insights, alerts };
}

async function loadSessionOutcomeStats(
  db: SqliteDatabase,
  sinceIso: string,
): Promise<{
  failureWasteUsd: number | null;
  successfulSessionCount: number | null;
  totalSessionsWithCost: number | null;
}> {
  try {
    const rows = await db.all<
      Array<{
        failure_count: number;
        cost_usd: number | null;
      }>
    >(
      `SELECT failure_count, cost_usd FROM sessions
       WHERE started_at >= ? AND cost_usd IS NOT NULL`,
      sinceIso,
    );
    if (rows.length === 0) {
      return {
        failureWasteUsd: null,
        successfulSessionCount: null,
        totalSessionsWithCost: null,
      };
    }
    let failureWaste = 0;
    let success = 0;
    let total = 0;
    for (const r of rows) {
      total += 1;
      if ((r.failure_count ?? 0) > 0) {
        failureWaste += r.cost_usd ?? 0;
      } else {
        success += 1;
      }
    }
    return {
      failureWasteUsd: failureWaste,
      successfulSessionCount: success,
      totalSessionsWithCost: total,
    };
  } catch {
    return {
      failureWasteUsd: null,
      successfulSessionCount: null,
      totalSessionsWithCost: null,
    };
  }
}
