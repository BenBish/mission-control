import type { Express, Request, Response } from "express";
import type { Database } from "../../db/database.js";
import { listSources } from "../../db/queries/sources.js";

export function registerSourceRoutes(app: Express, db: Database): void {
  app.get("/api/sources", async (_req: Request, res: Response) => {
    const sources = await listSources(db.raw());
    res.json({ success: true, sources });
  });
}
