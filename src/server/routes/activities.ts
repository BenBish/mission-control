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
import { optionalQueryString } from "../query.js";

export function registerActivityRoutes(app: Express, db: Database): void {
  app.get("/api/activities", async (req: Request, res: Response) => {
    const q = req.query;
    const filter: ActivityFilter = {
      sourceId: optionalQueryString(q.sourceId),
      sessionId: optionalQueryString(q.sessionId),
      actorId: optionalQueryString(q.actorId),
      actorType: optionalQueryString(q.actorType) as ActorType | undefined,
      actionType: optionalQueryString(q.actionType) as ActionType | undefined,
      toolName: optionalQueryString(q.toolName),
      status: optionalQueryString(q.status) as ActivityStatus | undefined,
      startTime: optionalQueryString(q.startTime),
      endTime: optionalQueryString(q.endTime),
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
