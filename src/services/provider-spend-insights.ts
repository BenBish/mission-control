/**
 * Provider spend insights: budget progress, burn rate, month-end forecast,
 * daily trends with prior-period comparison, and anomaly detection.
 *
 * Data source: provider_usage_daily only (API-sourced billing). Never mixes
 * session-log / agent-attributed costs — those live on Agent Usage views.
 *
 * Timezone / partial-data contract (surfaced in response meta):
 * - Month boundaries use the configured IANA timezone (default UTC).
 * - Day keys in storage are YYYY-MM-DD as reported by provider APIs; we
 *   treat them as calendar days in the budget timezone for MTD windows.
 * - Burn rate uses days elapsed in the month (including today as a full day
 *   for partial-month safety). Forecast = burnRate × daysInMonth.
 * - Delayed provider finalization can understate MTD; when any configured
 *   connector is error/stale, forecastReliable is false.
 * - Missing / not_configured connectors are listed but do not alone mark
 *   forecasts unreliable unless at least one configured connector is bad.
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
import { credentialMeta, getConnectors } from "./provider-connectors/index.js";

/** Stale if last success older than this (ms). Default 36h. */
export const SYNC_STALE_MS = 36 * 60 * 60 * 1000;

/** Rolling window for anomaly baseline (days before the evaluated day). */
export const ANOMALY_BASELINE_DAYS = 7;

/** Flag only when spend ≥ multiplier × baseline. */
export const ANOMALY_MULTIPLIER = 2;

/** Absolute floor so tiny noise does not flag. */
export const ANOMALY_MIN_USD = 1;

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

export interface SyncWarning {
  provider: string;
  status: string;
  reason: "error" | "stale" | "not_configured" | "limited";
  lastSuccessAt: string | null;
  lastError: string | null;
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
  notes: string[];
}

export interface SpendInsights {
  budget: {
    monthlyBudgetUsd: number | null;
    consumedUsd: number;
    remainingUsd: number | null;
    consumedPct: number | null;
  };
  burnRateUsdPerDay: number;
  forecastMonthEndUsd: number;
  dailyTrend: DailySpendPoint[];
  topBreakdown: BreakdownCompareRow[];
  anomalies: SpendAnomaly[];
  syncWarnings: SyncWarning[];
  meta: SpendInsightsMeta;
}

export interface ComputeInsightsInput {
  usage: ProviderUsageRow[];
  syncStatus: ProviderSyncStatusRow[];
  configuredProviderIds: string[];
  budget: ProviderBudgetConfig;
  now?: Date;
  staleMs?: number;
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

  for (const id of configured) {
    const row = byId.get(id);
    const status = row?.status ?? "unknown";
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
      // limited still has data — do not kill forecast reliability alone
    }
  }

  // Surface not_configured for awareness (does not affect reliability alone)
  for (const c of getConnectors()) {
    if (!configured.has(c.id)) {
      warnings.push({
        provider: c.id,
        status: "not_configured",
        reason: "not_configured",
        lastSuccessAt: null,
        lastError: null,
      });
    }
  }

  // If nothing is configured, forecasts are not reliable
  if (configured.size === 0) {
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
    if (baselineDays.length === 0) continue;
    const baseline = meanOf(baselineDays);
    if (baseline <= 0) {
      // No prior spend: only flag very large absolute spikes
      if (value >= ANOMALY_MIN_USD * 5) {
        anomalies.push({
          kind: "daily",
          day,
          provider: null,
          model: null,
          valueUsd: value,
          baselineUsd: 0,
          ratio: Infinity,
          message: `Daily spend $${value.toFixed(2)} on ${day} with no prior 7-day baseline`,
        });
      }
      continue;
    }
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

export function computeSpendInsights(
  input: ComputeInsightsInput,
): SpendInsights {
  const now = input.now ?? new Date();
  const staleMs = input.staleMs ?? SYNC_STALE_MS;
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
  const burnRateUsdPerDay = daysElapsed > 0 ? consumedUsd / daysElapsed : 0;
  const forecastMonthEndUsd = burnRateUsdPerDay * daysInMonth;

  const remainingUsd =
    monthlyBudgetUsd == null ? null : monthlyBudgetUsd - consumedUsd;
  const consumedPct =
    monthlyBudgetUsd == null || monthlyBudgetUsd === 0
      ? null
      : (consumedUsd / monthlyBudgetUsd) * 100;

  // Daily trend for current month (fill zeros)
  const dayTotals = dailyTotals(usage);
  const priorDayTotals = dailyTotals(priorRows);
  // Map prior days by day-of-month for comparison
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
  const { warnings: syncWarnings, forecastReliable } = evaluateSyncWarnings(
    input.syncStatus,
    input.configuredProviderIds,
    now,
    staleMs,
  );

  const notes: string[] = [
    "Costs are provider-API billing only; never summed with Agent Usage / session-log costs.",
    `Month window is ${monthStart} → ${monthEnd} in timezone ${timezone}.`,
    "Burn rate = MTD spend ÷ days elapsed (including today). Forecast = burn × days in month.",
    "Prior period compares the same day-of-month range in the previous calendar month.",
    `Anomalies: daily or provider/model spend ≥ ${ANOMALY_MULTIPLIER}× rolling ${ANOMALY_BASELINE_DAYS}-day mean and ≥ $${ANOMALY_MIN_USD}.`,
  ];
  if (partialMonth) {
    notes.push(
      "Partial month: forecast extrapolates current burn; early-month forecasts are high-variance.",
    );
  }
  if (!forecastReliable) {
    notes.push(
      "Forecast marked unreliable due to stale/error/missing configured provider syncs or no connectors configured.",
    );
  }
  notes.push(
    "Provider billing can lag finalization; re-syncs may revise recent day totals.",
  );

  return {
    budget: {
      monthlyBudgetUsd,
      consumedUsd,
      remainingUsd,
      consumedPct,
    },
    burnRateUsdPerDay,
    forecastMonthEndUsd,
    dailyTrend,
    topBreakdown,
    anomalies,
    syncWarnings,
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
      notes,
    },
  };
}

/** Load usage + sync + budget from DB and compute insights. */
export async function loadSpendInsights(
  db: SqliteDatabase,
  opts: { now?: Date } = {},
): Promise<SpendInsights> {
  const budget = await getProviderBudgetConfig(db);
  const now = opts.now ?? new Date();
  const today = formatDayInTimeZone(now, budget.timezone);
  const { year, month } = parseDay(today);
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  // History for baselines + prior month
  const since = addDays(monthStart, -45);

  const [usage, syncStatus] = await Promise.all([
    getProviderUsage(db, { since }),
    listProviderSyncStatus(db),
  ]);

  const configuredProviderIds = getConnectors()
    .filter((c) => credentialMeta(c.id).configured)
    .map((c) => c.id);

  return computeSpendInsights({
    usage,
    syncStatus,
    configuredProviderIds,
    budget,
    now,
  });
}
