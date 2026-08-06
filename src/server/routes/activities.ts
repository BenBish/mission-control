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
import type { AuthConfig } from "../auth.js";
import { resolvePrivacyPolicy } from "../privacy/policy.js";
import { presentActivity, requestAccess } from "../privacy/access.js";

export function registerActivityRoutes(
  app: Express,
  db: Database,
  authConfig: AuthConfig,
): void {
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
    const policy = resolvePrivacyPolicy();
    // List views never include raw details/result — even for owners
    res.json({
      success: true,
      activities: rows.map((row) =>
        presentActivity(
          rowToActivity(row) as unknown as Record<string, unknown>,
          {
            includeSensitive: false,
            policy,
          },
        ),
      ),
    });
  });

  app.get("/api/activities/:id", async (req: Request, res: Response) => {
    const row = await getActivity(db.raw(), req.params.id);
    if (!row) {
      return res
        .status(404)
        .json({ success: false, error: "Activity not found" });
    }
    const policy = resolvePrivacyPolicy();
    const { includeSensitive } = requestAccess(req, authConfig);
    res.json({
      success: true,
      activity: presentActivity(
        rowToActivity(row) as unknown as Record<string, unknown>,
        { includeSensitive, policy },
      ),
    });
  });
}
