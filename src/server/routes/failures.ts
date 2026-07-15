import type { Express, Request, Response } from "express";
import type { Database } from "../../db/database.js";
import { listRecentFailures } from "../../db/queries/failures.js";

export function registerFailureRoutes(app: Express, db: Database): void {
  app.get("/api/failures", async (req: Request, res: Response) => {
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const failures = await listRecentFailures(db.raw(), limit);
    res.json({ success: true, failures });
  });
}
