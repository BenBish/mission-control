import type { Express, Request, Response } from "express";
import type { Database } from "../../db/database.js";
import { getDailyConsumption } from "../../db/queries/consumption.js";

export function registerConsumptionRoutes(app: Express, db: Database): void {
  app.get("/api/consumption", async (req: Request, res: Response) => {
    const since =
      typeof req.query.since === "string" ? req.query.since : undefined;
    const sourceId =
      typeof req.query.sourceId === "string" ? req.query.sourceId : undefined;
    const rows = await getDailyConsumption(db.raw(), { since, sourceId });
    res.json({ success: true, consumption: rows });
  });
}
