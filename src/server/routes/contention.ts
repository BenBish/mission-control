import type { Express, Request, Response } from "express";
import type { Database } from "../../db/database.js";
import { listContentionIncidents } from "../../db/queries/contention.js";

/**
 * Backs the Jobs page's contention-incidents panel — see
 * src/db/queries/contention.ts's doc comment for what "incident" means
 * here and why this will likely be sparse: workload classification is a
 * best-effort heuristic, not ground truth.
 */
export function registerContentionRoutes(app: Express, db: Database): void {
  app.get("/api/contention", async (req: Request, res: Response) => {
    const since =
      typeof req.query.since === "string" ? req.query.since : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const incidents = await listContentionIncidents(db.raw(), { since, limit });
    res.json({ success: true, incidents });
  });
}
