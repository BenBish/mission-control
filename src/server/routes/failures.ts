import type { Express, Request, Response } from "express";
import type { Database } from "../../db/database.js";
import {
  getFailureSummary,
  listRecentFailures,
} from "../../db/queries/failures.js";
import { optionalQueryString } from "../query.js";

export function registerFailureRoutes(app: Express, db: Database): void {
  app.get("/api/failures", async (req: Request, res: Response) => {
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const sourceId = optionalQueryString(req.query.sourceId);
    const raw = db.raw();
    const [failures, summary] = await Promise.all([
      listRecentFailures(raw, limit, sourceId),
      getFailureSummary(raw, sourceId),
    ]);
    res.json({ success: true, failures, summary });
  });
}
