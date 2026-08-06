import type { Express, Request, Response } from "express";
import type { Database } from "../../db/database.js";
import {
  getProviderBudgetConfig,
  isValidIanaTimeZone,
  setProviderBudgetConfig,
} from "../../db/queries/app-settings.js";
import {
  latestProviderCreditSnapshots,
  listProviderCreditHistory,
  rowToApiCredit,
} from "../../db/queries/provider-credits.js";
import {
  getProviderUsage,
  getProviderUsageBreakdown,
  listProviderSyncStatus,
} from "../../db/queries/provider-usage.js";
import {
  deleteSpendBudget,
  listSpendBudgets,
  upsertSpendBudget,
  type SpendBudgetScopeType,
} from "../../db/queries/spend-budgets.js";
import {
  listSpendAlerts,
  updateSpendAlertDelivery,
  type SpendAlertDeliveryState,
} from "../../db/queries/spend-alerts.js";
import {
  credentialMeta,
  getConnectors,
  isProviderId,
  syncAllProviders,
  type ProviderId,
} from "../../services/provider-connectors/index.js";
import {
  loadSpendInsights,
  type ForecastMethod,
} from "../../services/provider-spend-insights.js";

const SCOPE_TYPES = new Set<SpendBudgetScopeType>([
  "account",
  "provider",
  "model",
  "project",
]);

function parseForecastMethod(raw: unknown): ForecastMethod | undefined {
  if (
    raw === "simple_mtd" ||
    raw === "trailing_7d" ||
    raw === "weighted_recency"
  ) {
    return raw;
  }
  return undefined;
}

function toIso(sqliteTimestamp: string | null): string | null {
  if (!sqliteTimestamp) return null;
  return sqliteTimestamp.includes("T")
    ? sqliteTimestamp
    : `${sqliteTimestamp.replace(" ", "T")}Z`;
}

export function registerProviderRoutes(app: Express, db: Database): void {
  /** Connector registry + last-sync status (never includes secrets). */
  app.get("/api/providers/status", async (_req: Request, res: Response) => {
    try {
      const statusRows = await listProviderSyncStatus(db.raw());
      const statusById = new Map(statusRows.map((r) => [r.provider, r]));

      const providers = getConnectors().map((c) => {
        const cred = credentialMeta(c.id);
        const row = statusById.get(c.id);
        let meta: { limitation?: string | null } | null = null;
        if (row?.meta_json) {
          try {
            meta = JSON.parse(row.meta_json) as { limitation?: string | null };
          } catch {
            meta = null;
          }
        }
        return {
          id: c.id,
          name: c.displayName,
          configured: cred.configured,
          envVars: cred.envVars,
          notes: cred.notes ?? null,
          status:
            row?.status ?? (cred.configured ? "unknown" : "not_configured"),
          lastSyncAt: toIso(row?.last_sync_at ?? null),
          lastSuccessAt: toIso(row?.last_success_at ?? null),
          lastError: row?.last_error ?? null,
          /** Non-error limitation (e.g. xAI metrics limited) — separate from lastError. */
          limitation: meta?.limitation ?? null,
          cursorDay: row?.cursor_day ?? null,
        };
      });

      res.json({ success: true, providers });
    } catch (err) {
      console.error("GET /api/providers/status failed:", err);
      res.status(500).json({
        success: false,
        error: "Failed to load provider status",
      });
    }
  });

  /** Trigger sync for all configured providers (or subset via body.providers). */
  app.post("/api/providers/sync", async (req: Request, res: Response) => {
    try {
      let providers: ProviderId[] | undefined;
      const bodyProviders = req.body?.providers;
      if (Array.isArray(bodyProviders)) {
        providers = bodyProviders.filter(
          (p: unknown): p is ProviderId =>
            typeof p === "string" && isProviderId(p),
        );
      }

      const results = await syncAllProviders(db.raw(), { providers });
      res.json({ success: true, results });
    } catch (err) {
      console.error("POST /api/providers/sync failed:", err);
      res.status(500).json({
        success: false,
        error: "Provider sync failed unexpectedly",
      });
    }
  });

  /** Daily usage rows from provider APIs (API-sourced, not session logs). */
  app.get("/api/providers/usage", async (req: Request, res: Response) => {
    try {
      const since =
        typeof req.query.since === "string" ? req.query.since : undefined;
      const provider =
        typeof req.query.provider === "string" &&
        isProviderId(req.query.provider)
          ? req.query.provider
          : undefined;
      const rows = await getProviderUsage(db.raw(), { since, provider });
      res.json({
        success: true,
        source: "provider-api",
        usage: rows,
      });
    } catch (err) {
      console.error("GET /api/providers/usage failed:", err);
      res.status(500).json({
        success: false,
        error: "Failed to load provider usage",
      });
    }
  });

  /** Aggregated breakdown by provider + model for Consumption UI. */
  app.get(
    "/api/providers/usage/breakdown",
    async (req: Request, res: Response) => {
      try {
        const since =
          typeof req.query.since === "string" ? req.query.since : undefined;
        const provider =
          typeof req.query.provider === "string" &&
          isProviderId(req.query.provider)
            ? req.query.provider
            : undefined;
        const rows = await getProviderUsageBreakdown(db.raw(), {
          since,
          provider,
        });
        res.json({
          success: true,
          source: "provider-api",
          breakdown: rows,
        });
      } catch (err) {
        console.error("GET /api/providers/usage/breakdown failed:", err);
        res.status(500).json({
          success: false,
          error: "Failed to load provider usage breakdown",
        });
      }
    },
  );

  /**
   * Monthly provider-spend budget config (account-wide Direct API Spend only).
   * Does not apply to Agent Usage / session-log costs.
   */
  app.get("/api/providers/budget", async (_req: Request, res: Response) => {
    try {
      const budget = await getProviderBudgetConfig(db.raw());
      res.json({
        success: true,
        source: "provider-api",
        budget,
      });
    } catch (err) {
      console.error("GET /api/providers/budget failed:", err);
      res.status(500).json({
        success: false,
        error: "Failed to load provider budget",
      });
    }
  });

  app.put("/api/providers/budget", async (req: Request, res: Response) => {
    try {
      const body = req.body ?? {};
      let monthlyBudgetUsd: number | null;
      if (body.monthlyBudgetUsd === null || body.monthlyBudgetUsd === "") {
        monthlyBudgetUsd = null;
      } else if (typeof body.monthlyBudgetUsd === "number") {
        monthlyBudgetUsd = body.monthlyBudgetUsd;
      } else if (
        typeof body.monthlyBudgetUsd === "string" &&
        body.monthlyBudgetUsd.trim() !== ""
      ) {
        monthlyBudgetUsd = Number(body.monthlyBudgetUsd);
      } else if (body.monthlyBudgetUsd === undefined) {
        // Keep existing budget amount; only timezone may change
        const existing = await getProviderBudgetConfig(db.raw());
        monthlyBudgetUsd = existing.monthlyBudgetUsd;
      } else {
        res.status(400).json({
          success: false,
          error: "monthlyBudgetUsd must be a non-negative number or null",
        });
        return;
      }

      if (
        monthlyBudgetUsd !== null &&
        (!Number.isFinite(monthlyBudgetUsd) || monthlyBudgetUsd < 0)
      ) {
        res.status(400).json({
          success: false,
          error: "monthlyBudgetUsd must be a non-negative number or null",
        });
        return;
      }

      let timezone: string | undefined;
      if (body.timezone !== undefined) {
        if (
          typeof body.timezone !== "string" ||
          !isValidIanaTimeZone(body.timezone)
        ) {
          res.status(400).json({
            success: false,
            error: "timezone must be a valid IANA timezone string",
          });
          return;
        }
        timezone = body.timezone;
      }

      const budget = await setProviderBudgetConfig(db.raw(), {
        monthlyBudgetUsd,
        timezone,
      });
      res.json({
        success: true,
        source: "provider-api",
        budget,
      });
    } catch (err) {
      console.error("PUT /api/providers/budget failed:", err);
      const message =
        err instanceof Error ? err.message : "Failed to update provider budget";
      const isValidation = /non-negative|Invalid IANA|must be a valid/i.test(
        message,
      );
      res.status(isValidation ? 400 : 500).json({
        success: false,
        error: message,
      });
    }
  });

  /**
   * Budget progress, burn rate, forecast, daily trend, prior-period breakdown,
   * anomalies, efficiency, recommendations, scoped budgets, alert history,
   * and sync reliability for Direct API Spend (BSH-105).
   *
   * Query: ?method=simple_mtd|trailing_7d|weighted_recency
   *        &billingLagDays=N
   */
  app.get(
    "/api/providers/spend-insights",
    async (req: Request, res: Response) => {
      try {
        const method = parseForecastMethod(req.query.method);
        let billingLagDays: number | undefined;
        if (typeof req.query.billingLagDays === "string") {
          const n = Number(req.query.billingLagDays);
          if (Number.isFinite(n) && n >= 0 && n <= 14) {
            billingLagDays = Math.floor(n);
          }
        }
        const insights = await loadSpendInsights(db.raw(), {
          forecastMethod: method ?? "trailing_7d",
          billingLagDays,
          persistAlerts: true,
        });
        res.json({
          success: true,
          ...insights,
        });
      } catch (err) {
        console.error("GET /api/providers/spend-insights failed:", err);
        res.status(500).json({
          success: false,
          error: "Failed to load provider spend insights",
        });
      }
    },
  );

  /**
   * Scoped spend budgets (account / provider / model / project).
   * Consumed against actual provider spend except project scope (agent).
   */
  app.get("/api/providers/budgets", async (_req: Request, res: Response) => {
    try {
      const budgets = await listSpendBudgets(db.raw());
      res.json({ success: true, budgets });
    } catch (err) {
      console.error("GET /api/providers/budgets failed:", err);
      res.status(500).json({
        success: false,
        error: "Failed to list scoped budgets",
      });
    }
  });

  app.put("/api/providers/budgets", async (req: Request, res: Response) => {
    try {
      const body = req.body ?? {};
      const scopeType = body.scopeType as SpendBudgetScopeType;
      if (!SCOPE_TYPES.has(scopeType)) {
        res.status(400).json({
          success: false,
          error: "scopeType must be account|provider|model|project",
        });
        return;
      }
      const scopeKey =
        typeof body.scopeKey === "string"
          ? body.scopeKey
          : scopeType === "account"
            ? "*"
            : "";
      const monthlyBudgetUsd = Number(body.monthlyBudgetUsd);
      if (!Number.isFinite(monthlyBudgetUsd) || monthlyBudgetUsd < 0) {
        res.status(400).json({
          success: false,
          error: "monthlyBudgetUsd must be a non-negative number",
        });
        return;
      }
      const budget = await upsertSpendBudget(db.raw(), {
        id: typeof body.id === "string" ? body.id : undefined,
        scopeType,
        scopeKey,
        monthlyBudgetUsd,
        warnThresholdPct:
          body.warnThresholdPct !== undefined
            ? Number(body.warnThresholdPct)
            : undefined,
        criticalThresholdPct:
          body.criticalThresholdPct !== undefined
            ? Number(body.criticalThresholdPct)
            : undefined,
        enabled: body.enabled === false ? false : true,
      });
      res.json({ success: true, budget });
    } catch (err) {
      console.error("PUT /api/providers/budgets failed:", err);
      const message =
        err instanceof Error ? err.message : "Failed to save scoped budget";
      const isValidation =
        /scopeKey|monthlyBudgetUsd|warnThreshold|criticalThreshold/i.test(
          message,
        );
      res.status(isValidation ? 400 : 500).json({
        success: false,
        error: message,
      });
    }
  });

  app.delete(
    "/api/providers/budgets/:id",
    async (req: Request, res: Response) => {
      try {
        const id = req.params.id;
        if (!id) {
          res.status(400).json({ success: false, error: "id required" });
          return;
        }
        const ok = await deleteSpendBudget(db.raw(), id);
        if (!ok) {
          res.status(404).json({ success: false, error: "Budget not found" });
          return;
        }
        res.json({ success: true });
      } catch (err) {
        console.error("DELETE /api/providers/budgets/:id failed:", err);
        res.status(500).json({
          success: false,
          error: "Failed to delete scoped budget",
        });
      }
    },
  );

  /** Alert delivery history for threshold / anomaly events. */
  app.get(
    "/api/providers/spend-alerts",
    async (req: Request, res: Response) => {
      try {
        const limit =
          typeof req.query.limit === "string" ? Number(req.query.limit) : 50;
        const monthKey =
          typeof req.query.monthKey === "string"
            ? req.query.monthKey
            : undefined;
        const deliveryState = (
          typeof req.query.deliveryState === "string"
            ? req.query.deliveryState
            : undefined
        ) as SpendAlertDeliveryState | undefined;
        const alerts = await listSpendAlerts(db.raw(), {
          limit,
          monthKey,
          deliveryState,
        });
        res.json({ success: true, alerts });
      } catch (err) {
        console.error("GET /api/providers/spend-alerts failed:", err);
        res.status(500).json({
          success: false,
          error: "Failed to list spend alerts",
        });
      }
    },
  );

  app.patch(
    "/api/providers/spend-alerts/:id",
    async (req: Request, res: Response) => {
      try {
        const id = req.params.id;
        const state = req.body?.deliveryState as SpendAlertDeliveryState;
        const allowed: SpendAlertDeliveryState[] = [
          "pending",
          "delivered",
          "acknowledged",
          "suppressed",
          "failed",
        ];
        if (!id || !allowed.includes(state)) {
          res.status(400).json({
            success: false,
            error:
              "deliveryState must be pending|delivered|acknowledged|suppressed|failed",
          });
          return;
        }
        const alert = await updateSpendAlertDelivery(db.raw(), id, state);
        if (!alert) {
          res.status(404).json({ success: false, error: "Alert not found" });
          return;
        }
        res.json({ success: true, alert });
      } catch (err) {
        console.error("PATCH /api/providers/spend-alerts/:id failed:", err);
        res.status(500).json({
          success: false,
          error: "Failed to update spend alert",
        });
      }
    },
  );

  /**
   * Plan usage windows + usage-credit wallet snapshots (account-wide).
   * Distinct from Direct API Spend (daily cost) and agent session costUsd.
   * Response groups BSH-93 surfaces: planUsage vs wallet (plus flat credits[]).
   * Query: ?history=1 for recent history; default is latest per provider+label.
   */
  app.get("/api/providers/credits", async (req: Request, res: Response) => {
    try {
      const provider =
        typeof req.query.provider === "string" &&
        isProviderId(req.query.provider)
          ? req.query.provider
          : undefined;
      const history =
        req.query.history === "1" ||
        req.query.history === "true" ||
        req.query.history === "yes";

      const rows = history
        ? await listProviderCreditHistory(db.raw(), {
            provider,
            limit:
              typeof req.query.limit === "string"
                ? Number(req.query.limit)
                : 100,
          })
        : await latestProviderCreditSnapshots(db.raw(), { provider });

      const credits = rows.map(rowToApiCredit);
      const planUsage = credits.filter((c) => c.surface === "plan_usage");
      const wallet = credits.filter((c) => c.surface === "wallet");

      res.json({
        success: true,
        source: "provider-credits",
        note: "Plan usage and usage-credit wallets are not included in agent session costUsd or Direct API Spend (API org spend) sums.",
        /** Flat list (compat). Prefer planUsage / wallet for UI. */
        credits,
        planUsage,
        wallet,
      });
    } catch (err) {
      console.error("GET /api/providers/credits failed:", err);
      res.status(500).json({
        success: false,
        error: "Failed to load provider credits",
      });
    }
  });
}
