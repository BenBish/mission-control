import type { Express, Request, Response } from "express";
import type { Database } from "../../db/database.js";
import {
  getFailureSummary,
  listRecentFailures,
} from "../../db/queries/failures.js";
import { optionalQueryString, parseOptionalPositiveInt } from "../query.js";

export function registerFailureRoutes(app: Express, db: Database): void {
  app.get("/api/failures", async (req: Request, res: Response) => {
    try {
      const limitResult = parseOptionalPositiveInt(req.query.limit, "limit");
      if (!limitResult.ok) {
        res.status(400).json({ success: false, error: limitResult.error });
        return;
      }

      // sourceId must be a single scalar string when present (not an array)
      if (Array.isArray(req.query.sourceId)) {
        res.status(400).json({
          success: false,
          error: "sourceId must be a single string",
        });
        return;
      }

      const sourceId = optionalQueryString(req.query.sourceId);
      const raw = db.raw();
      const [failures, summary] = await Promise.all([
        listRecentFailures(raw, limitResult.value, sourceId),
        getFailureSummary(raw, sourceId),
      ]);
      res.json({ success: true, failures, summary });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[failures] GET /api/failures failed:", message);
      res.status(500).json({
        success: false,
        error: "Failed to load failures",
      });
    }
  });
}
