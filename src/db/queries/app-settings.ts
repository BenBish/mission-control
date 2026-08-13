import type { Database as SqliteDatabase } from "sqlite";

export const SETTING_PROVIDER_MONTHLY_BUDGET_USD =
  "provider_monthly_budget_usd";
export const SETTING_PROVIDER_BUDGET_TIMEZONE = "provider_budget_timezone";

export const SETTING_PLAN_USAGE_WARN_REMAINING_PCT =
  "plan_usage_warn_remaining_pct";
export const SETTING_PLAN_USAGE_CRITICAL_REMAINING_PCT =
  "plan_usage_critical_remaining_pct";
export const SETTING_WALLET_WARN_REMAINING_USD = "wallet_warn_remaining_usd";
export const SETTING_WALLET_CRITICAL_REMAINING_USD =
  "wallet_critical_remaining_usd";

export const DEFAULT_PLAN_USAGE_WARN_REMAINING_PCT = 20;
export const DEFAULT_PLAN_USAGE_CRITICAL_REMAINING_PCT = 5;
export const DEFAULT_WALLET_WARN_REMAINING_USD = 10;
export const DEFAULT_WALLET_CRITICAL_REMAINING_USD = 2;

export const DEFAULT_BUDGET_TIMEZONE = "UTC";

export interface AppSettingRow {
  key: string;
  value: string;
  updated_at: string | null;
}

export async function getSetting(
  db: SqliteDatabase,
  key: string,
): Promise<string | null> {
  const row = await db.get<AppSettingRow>(
    `SELECT key, value, updated_at FROM app_settings WHERE key = ?`,
    key,
  );
  return row?.value ?? null;
}

export async function setSetting(
  db: SqliteDatabase,
  key: string,
  value: string,
): Promise<void> {
  await db.run(
    `
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = CURRENT_TIMESTAMP
    `,
    key,
    value,
  );
}

export async function deleteSetting(
  db: SqliteDatabase,
  key: string,
): Promise<void> {
  await db.run(`DELETE FROM app_settings WHERE key = ?`, key);
}

export interface ProviderBudgetConfig {
  /** Monthly budget in USD; null means no budget configured. */
  monthlyBudgetUsd: number | null;
  /** IANA timezone for month boundaries. Default UTC. */
  timezone: string;
}

export async function getProviderBudgetConfig(
  db: SqliteDatabase,
): Promise<ProviderBudgetConfig> {
  const [budgetRaw, tzRaw] = await Promise.all([
    getSetting(db, SETTING_PROVIDER_MONTHLY_BUDGET_USD),
    getSetting(db, SETTING_PROVIDER_BUDGET_TIMEZONE),
  ]);

  let monthlyBudgetUsd: number | null = null;
  if (budgetRaw != null && budgetRaw !== "") {
    const n = Number(budgetRaw);
    if (Number.isFinite(n) && n >= 0) {
      monthlyBudgetUsd = n;
    }
  }

  const timezone =
    tzRaw && isValidIanaTimeZone(tzRaw) ? tzRaw : DEFAULT_BUDGET_TIMEZONE;

  return { monthlyBudgetUsd, timezone };
}

export async function setProviderBudgetConfig(
  db: SqliteDatabase,
  config: { monthlyBudgetUsd: number | null; timezone?: string },
): Promise<ProviderBudgetConfig> {
  if (config.monthlyBudgetUsd === null) {
    await deleteSetting(db, SETTING_PROVIDER_MONTHLY_BUDGET_USD);
  } else {
    if (
      !Number.isFinite(config.monthlyBudgetUsd) ||
      config.monthlyBudgetUsd < 0
    ) {
      throw new Error("monthlyBudgetUsd must be a non-negative number or null");
    }
    await setSetting(
      db,
      SETTING_PROVIDER_MONTHLY_BUDGET_USD,
      String(config.monthlyBudgetUsd),
    );
  }

  if (config.timezone !== undefined) {
    if (!isValidIanaTimeZone(config.timezone)) {
      throw new Error(`Invalid IANA timezone: ${config.timezone}`);
    }
    await setSetting(db, SETTING_PROVIDER_BUDGET_TIMEZONE, config.timezone);
  }

  return getProviderBudgetConfig(db);
}

export interface CapacityAlertConfig {
  /** Warn when a fresh plan-usage window is at or below this remaining %. 0 disables. */
  planUsageWarnRemainingPct: number;
  /** Critical when a fresh plan-usage window is at or below this remaining %. 0 disables. */
  planUsageCriticalRemainingPct: number;
  /** Warn when a fresh wallet balance is at or below this USD amount. 0 disables. */
  walletWarnRemainingUsd: number;
  /** Critical when a fresh wallet balance is at or below this USD amount. 0 disables. */
  walletCriticalRemainingUsd: number;
}

function parseNonNegativeNumber(raw: string | null, fallback: number): number {
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function defaultCapacityAlertConfig(): CapacityAlertConfig {
  return {
    planUsageWarnRemainingPct: DEFAULT_PLAN_USAGE_WARN_REMAINING_PCT,
    planUsageCriticalRemainingPct: DEFAULT_PLAN_USAGE_CRITICAL_REMAINING_PCT,
    walletWarnRemainingUsd: DEFAULT_WALLET_WARN_REMAINING_USD,
    walletCriticalRemainingUsd: DEFAULT_WALLET_CRITICAL_REMAINING_USD,
  };
}

export async function getCapacityAlertConfig(
  db: SqliteDatabase,
): Promise<CapacityAlertConfig> {
  const [warnPct, critPct, warnUsd, critUsd] = await Promise.all([
    getSetting(db, SETTING_PLAN_USAGE_WARN_REMAINING_PCT),
    getSetting(db, SETTING_PLAN_USAGE_CRITICAL_REMAINING_PCT),
    getSetting(db, SETTING_WALLET_WARN_REMAINING_USD),
    getSetting(db, SETTING_WALLET_CRITICAL_REMAINING_USD),
  ]);
  return {
    planUsageWarnRemainingPct: parseNonNegativeNumber(
      warnPct,
      DEFAULT_PLAN_USAGE_WARN_REMAINING_PCT,
    ),
    planUsageCriticalRemainingPct: parseNonNegativeNumber(
      critPct,
      DEFAULT_PLAN_USAGE_CRITICAL_REMAINING_PCT,
    ),
    walletWarnRemainingUsd: parseNonNegativeNumber(
      warnUsd,
      DEFAULT_WALLET_WARN_REMAINING_USD,
    ),
    walletCriticalRemainingUsd: parseNonNegativeNumber(
      critUsd,
      DEFAULT_WALLET_CRITICAL_REMAINING_USD,
    ),
  };
}

function assertThresholdPair(
  warn: number,
  critical: number,
  warnName: string,
  criticalName: string,
  max?: number,
): void {
  if (!Number.isFinite(warn) || warn < 0) {
    throw new Error(`${warnName} must be a non-negative number`);
  }
  if (!Number.isFinite(critical) || critical < 0) {
    throw new Error(`${criticalName} must be a non-negative number`);
  }
  if (max != null && (warn > max || critical > max)) {
    throw new Error(`${warnName} and ${criticalName} must be ≤ ${max}`);
  }
  if (critical > 0 && warn > 0 && critical > warn) {
    throw new Error(
      `${criticalName} must be ≤ ${warnName} (critical is the lower remaining threshold)`,
    );
  }
}

export async function setCapacityAlertConfig(
  db: SqliteDatabase,
  config: Partial<CapacityAlertConfig>,
): Promise<CapacityAlertConfig> {
  const current = await getCapacityAlertConfig(db);
  const next: CapacityAlertConfig = {
    planUsageWarnRemainingPct:
      config.planUsageWarnRemainingPct ?? current.planUsageWarnRemainingPct,
    planUsageCriticalRemainingPct:
      config.planUsageCriticalRemainingPct ??
      current.planUsageCriticalRemainingPct,
    walletWarnRemainingUsd:
      config.walletWarnRemainingUsd ?? current.walletWarnRemainingUsd,
    walletCriticalRemainingUsd:
      config.walletCriticalRemainingUsd ?? current.walletCriticalRemainingUsd,
  };

  assertThresholdPair(
    next.planUsageWarnRemainingPct,
    next.planUsageCriticalRemainingPct,
    "planUsageWarnRemainingPct",
    "planUsageCriticalRemainingPct",
    100,
  );
  assertThresholdPair(
    next.walletWarnRemainingUsd,
    next.walletCriticalRemainingUsd,
    "walletWarnRemainingUsd",
    "walletCriticalRemainingUsd",
  );

  await Promise.all([
    setSetting(
      db,
      SETTING_PLAN_USAGE_WARN_REMAINING_PCT,
      String(next.planUsageWarnRemainingPct),
    ),
    setSetting(
      db,
      SETTING_PLAN_USAGE_CRITICAL_REMAINING_PCT,
      String(next.planUsageCriticalRemainingPct),
    ),
    setSetting(
      db,
      SETTING_WALLET_WARN_REMAINING_USD,
      String(next.walletWarnRemainingUsd),
    ),
    setSetting(
      db,
      SETTING_WALLET_CRITICAL_REMAINING_USD,
      String(next.walletCriticalRemainingUsd),
    ),
  ]);

  return getCapacityAlertConfig(db);
}

/** Validate IANA timezone via Intl (throws RangeError if invalid). */
export function isValidIanaTimeZone(tz: string): boolean {
  if (!tz || typeof tz !== "string") return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
