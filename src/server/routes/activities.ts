import type { Express, Request, Response } from "express";
import type { Database } from "../../db/database.js";
import {
  listActivities,
  getActivity,
  rowToActivity,
} from "../../db/queries/activities.js";
import type {
  ActivityFilter,
  ActorType,
  ActionType,
  ActivityStatus,
} from "../../types/activity.js";

export function registerActivityRoutes(app: Express, db: Database): void {
  app.get("/api/activities", async (req: Request, res: Response) => {
    const q = req.query;
    const filter: ActivityFilter = {
      sourceId: typeof q.sourceId === "string" ? q.sourceId : undefined,
      sessionId: typeof q.sessionId === "string" ? q.sessionId : undefined,
      actorId: typeof q.actorId === "string" ? q.actorId : undefined,
      actorType:
        typeof q.actorType === "string"
          ? (q.actorType as ActorType)
          : undefined,
      actionType:
        typeof q.actionType === "string"
          ? (q.actionType as ActionType)
          : undefined,
      toolName: typeof q.toolName === "string" ? q.toolName : undefined,
      status:
        typeof q.status === "string" ? (q.status as ActivityStatus) : undefined,
      startTime: typeof q.startTime === "string" ? q.startTime : undefined,
      endTime: typeof q.endTime === "string" ? q.endTime : undefined,
      limit: q.limit ? Number(q.limit) : undefined,
      offset: q.offset ? Number(q.offset) : undefined,
    };
    const rows = await listActivities(db.raw(), filter);
    res.json({ success: true, activities: rows.map(rowToActivity) });
  });

  app.get("/api/activities/:id", async (req: Request, res: Response) => {
    const row = await getActivity(db.raw(), req.params.id);
    if (!row) {
      return res
        .status(404)
        .json({ success: false, error: "Activity not found" });
    }
    res.json({ success: true, activity: rowToActivity(row) });
  });
}
