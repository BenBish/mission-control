/**
 * Scoped provider spend budgets (account / provider / model / project).
 * Account-wide legacy config still lives in app_settings; these rows extend
 * it so operators can cap spend by dimension without conflating datasets.
 */

import { randomUUID } from "crypto";
import type { Database as SqliteDatabase } from "sqlite";

export type SpendBudgetScopeType = "account" | "provider" | "model" | "project";

export interface SpendBudgetRow {
  id: string;
  scope_type: SpendBudgetScopeType;
  scope_key: string;
  monthly_budget_usd: number;
  warn_threshold_pct: number;
  critical_threshold_pct: number;
  enabled: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface SpendBudget {
  id: string;
  scopeType: SpendBudgetScopeType;
  /** For account: "*". For provider: id. For model: "provider/model". For project: label. */
  scopeKey: string;
  monthlyBudgetUsd: number;
  warnThresholdPct: number;
  criticalThresholdPct: number;
  enabled: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

function rowToBudget(row: SpendBudgetRow): SpendBudget {
  return {
    id: row.id,
    scopeType: row.scope_type,
    scopeKey: row.scope_key,
    monthlyBudgetUsd: row.monthly_budget_usd,
    warnThresholdPct: row.warn_threshold_pct,
    criticalThresholdPct: row.critical_threshold_pct,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listSpendBudgets(
  db: SqliteDatabase,
  opts: { enabledOnly?: boolean } = {},
): Promise<SpendBudget[]> {
  const rows = opts.enabledOnly
    ? await db.all<SpendBudgetRow[]>(
        `SELECT * FROM provider_spend_budgets WHERE enabled = 1
         ORDER BY scope_type, scope_key`,
      )
    : await db.all<SpendBudgetRow[]>(
        `SELECT * FROM provider_spend_budgets
         ORDER BY scope_type, scope_key`,
      );
  return rows.map(rowToBudget);
}

export async function getSpendBudget(
  db: SqliteDatabase,
  id: string,
): Promise<SpendBudget | null> {
  const row = await db.get<SpendBudgetRow>(
    `SELECT * FROM provider_spend_budgets WHERE id = ?`,
    id,
  );
  return row ? rowToBudget(row) : null;
}

export async function upsertSpendBudget(
  db: SqliteDatabase,
  input: {
    id?: string;
    scopeType: SpendBudgetScopeType;
    scopeKey: string;
    monthlyBudgetUsd: number;
    warnThresholdPct?: number;
    criticalThresholdPct?: number;
    enabled?: boolean;
  },
): Promise<SpendBudget> {
  const scopeKey =
    input.scopeType === "account"
      ? "*"
      : input.scopeKey.trim().length > 0
        ? input.scopeKey.trim()
        : "";
  if (input.scopeType !== "account" && !scopeKey) {
    throw new Error("scopeKey is required for non-account budgets");
  }
  if (!Number.isFinite(input.monthlyBudgetUsd) || input.monthlyBudgetUsd < 0) {
    throw new Error("monthlyBudgetUsd must be a non-negative number");
  }

  const warn =
    input.warnThresholdPct !== undefined ? input.warnThresholdPct : 80;
  const critical =
    input.criticalThresholdPct !== undefined ? input.criticalThresholdPct : 100;
  if (!Number.isFinite(warn) || warn <= 0 || warn > 100) {
    throw new Error("warnThresholdPct must be in (0, 100]");
  }
  if (!Number.isFinite(critical) || critical <= 0 || critical > 200) {
    throw new Error("criticalThresholdPct must be in (0, 200]");
  }

  const enabled = input.enabled === false ? 0 : 1;
  const id = input.id ?? randomUUID();

  await db.run(
    `
    INSERT INTO provider_spend_budgets (
      id, scope_type, scope_key, monthly_budget_usd,
      warn_threshold_pct, critical_threshold_pct, enabled,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(scope_type, scope_key) DO UPDATE SET
      monthly_budget_usd = excluded.monthly_budget_usd,
      warn_threshold_pct = excluded.warn_threshold_pct,
      critical_threshold_pct = excluded.critical_threshold_pct,
      enabled = excluded.enabled,
      updated_at = CURRENT_TIMESTAMP
    `,
    id,
    input.scopeType,
    scopeKey || "*",
    input.monthlyBudgetUsd,
    warn,
    critical,
    enabled,
  );

  // Prefer looking up by unique scope so re-upserts return the existing id
  const row = await db.get<SpendBudgetRow>(
    `SELECT * FROM provider_spend_budgets WHERE scope_type = ? AND scope_key = ?`,
    input.scopeType,
    scopeKey || "*",
  );
  if (!row) throw new Error("Failed to persist spend budget");
  return rowToBudget(row);
}

export async function deleteSpendBudget(
  db: SqliteDatabase,
  id: string,
): Promise<boolean> {
  const result = await db.run(
    `DELETE FROM provider_spend_budgets WHERE id = ?`,
    id,
  );
  return (result.changes ?? 0) > 0;
}
