import type { Database as SqliteDatabase } from "sqlite";

export const SETTING_PROVIDER_MONTHLY_BUDGET_USD =
  "provider_monthly_budget_usd";
export const SETTING_PROVIDER_BUDGET_TIMEZONE = "provider_budget_timezone";

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
