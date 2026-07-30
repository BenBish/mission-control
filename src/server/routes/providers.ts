import type { Express, Request, Response } from "express";
import type { Database } from "../../db/database.js";
import {
  getProviderBudgetConfig,
  isValidIanaTimeZone,
  setProviderBudgetConfig,
} from "../../db/queries/app-settings.js";
import {
  getProviderUsage,
  getProviderUsageBreakdown,
  listProviderSyncStatus,
} from "../../db/queries/provider-usage.js";
import {
  credentialMeta,
  getConnectors,
  isProviderId,
  syncAllProviders,
  type ProviderId,
} from "../../services/provider-connectors/index.js";
import { loadSpendInsights } from "../../services/provider-spend-insights.js";

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
      res.status(400).json({
        success: false,
        error: message,
      });
    }
  });

  /**
   * Budget progress, burn rate, forecast, daily trend, prior-period breakdown,
   * anomalies, and sync reliability for Direct API Spend.
   */
  app.get(
    "/api/providers/spend-insights",
    async (_req: Request, res: Response) => {
      try {
        const insights = await loadSpendInsights(db.raw());
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
}
