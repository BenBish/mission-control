import type { Express, Request, Response } from "express";
import type { Database } from "../../db/database.js";
import { getDailyConsumption } from "../../db/queries/consumption.js";
import { optionalQueryString } from "../query.js";

export function registerConsumptionRoutes(app: Express, db: Database): void {
  app.get("/api/consumption", async (req: Request, res: Response) => {
    const since = optionalQueryString(req.query.since);
    const sourceId = optionalQueryString(req.query.sourceId);
    const rows = await getDailyConsumption(db.raw(), { since, sourceId });
    res.json({ success: true, consumption: rows });
  });
}
