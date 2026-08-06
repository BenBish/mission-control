import type { Express, Request, Response } from "express";
import type { Database } from "../../db/database.js";
import { getDailyConsumption } from "../../db/queries/consumption.js";
import {
  getAgentUsageSessionsForDriver,
  getAgentUsageSummary,
  type AgentUsageDimension,
} from "../../services/agent-usage.js";
import { optionalQueryString } from "../query.js";

const DIMENSIONS = new Set<AgentUsageDimension>([
  "model",
  "project",
  "actor",
  "source",
  "session",
]);

function parseDimension(raw: string | undefined): AgentUsageDimension {
  if (raw && DIMENSIONS.has(raw as AgentUsageDimension)) {
    return raw as AgentUsageDimension;
  }
  return "model";
}

export function registerConsumptionRoutes(app: Express, db: Database): void {
  app.get("/api/consumption", async (req: Request, res: Response) => {
    const since = optionalQueryString(req.query.since);
    const sourceId = optionalQueryString(req.query.sourceId);
    const rows = await getDailyConsumption(db.raw(), { since, sourceId });
    res.json({ success: true, consumption: rows });
  });

  /**
   * Typed Agent Usage summary with canonical models, coverage, and ranked drivers.
   * Query: since, until, sourceId, dimension, includeNonMaterial=1
   */
  app.get(
    "/api/consumption/agent-usage",
    async (req: Request, res: Response) => {
      try {
        const since = optionalQueryString(req.query.since);
        const until = optionalQueryString(req.query.until);
        const sourceId = optionalQueryString(req.query.sourceId);
        const dimension = parseDimension(
          optionalQueryString(req.query.dimension),
        );
        const includeNonMaterial =
          optionalQueryString(req.query.includeNonMaterial) === "1" ||
          optionalQueryString(req.query.includeNonMaterial) === "true";

        const summary = await getAgentUsageSummary(db.raw(), {
          since,
          until,
          sourceId,
          dimension,
          includeNonMaterial,
        });

        res.json({
          success: true,
          source: "agent-usage",
          ...summary,
        });
      } catch (err) {
        console.error("GET /api/consumption/agent-usage failed:", err);
        res.status(500).json({
          success: false,
          error: "Failed to load agent usage summary",
        });
      }
    },
  );

  /**
   * Sessions contributing to a ranked driver (drill-down).
   * Query: since, until, sourceId, dimension, driverKey
   */
  app.get(
    "/api/consumption/agent-usage/sessions",
    async (req: Request, res: Response) => {
      try {
        const since = optionalQueryString(req.query.since);
        const until = optionalQueryString(req.query.until);
        const sourceId = optionalQueryString(req.query.sourceId);
        const dimension = parseDimension(
          optionalQueryString(req.query.dimension),
        );
        const driverKey = optionalQueryString(req.query.driverKey);
        if (!driverKey) {
          res.status(400).json({
            success: false,
            error: "driverKey is required",
          });
          return;
        }

        const sessions = await getAgentUsageSessionsForDriver(db.raw(), {
          since,
          until,
          sourceId,
          dimension,
          driverKey,
        });

        res.json({
          success: true,
          source: "agent-usage",
          dimension,
          driverKey,
          sessions,
        });
      } catch (err) {
        console.error("GET /api/consumption/agent-usage/sessions failed:", err);
        res.status(500).json({
          success: false,
          error: "Failed to load agent usage sessions",
        });
      }
    },
  );
}
