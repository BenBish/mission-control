import type { Express, Request, Response } from "express";
import type { Database } from "../../db/database.js";
import {
  listSessions,
  getSessionRow,
  rowToSessionSummary,
} from "../../db/queries/sessions.js";
import {
  listSessionActivities,
  rowToActivity,
} from "../../db/queries/activities.js";

export function registerSessionRoutes(app: Express, db: Database): void {
  app.get("/api/sessions", async (req: Request, res: Response) => {
    const sourceId =
      typeof req.query.sourceId === "string" ? req.query.sourceId : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const offset = req.query.offset ? Number(req.query.offset) : undefined;
    const rows = await listSessions(db.raw(), { sourceId, limit, offset });
    res.json({
      success: true,
      sessions: rows.map((r) => rowToSessionSummary(r)),
    });
  });

  // Activities are ordered oldest-first and carry actor.type + parentActivityId/
  // parentExternalId so the frontend's SessionTimeline swimlane can lay out
  // sidechain lanes without a second request.
  app.get("/api/sessions/:id", async (req: Request, res: Response) => {
    const session = await getSessionRow(db.raw(), req.params.id);
    if (!session) {
      return res
        .status(404)
        .json({ success: false, error: "Session not found" });
    }
    const activityRows = await listSessionActivities(db.raw(), session.id);
    res.json({
      success: true,
      session: {
        ...rowToSessionSummary(session),
        activities: activityRows.map(rowToActivity),
      },
    });
  });
}
