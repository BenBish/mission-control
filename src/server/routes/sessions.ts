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
import { optionalQueryString } from "../query.js";
import type { AuthConfig } from "../auth.js";
import { resolvePrivacyPolicy } from "../privacy/policy.js";
import {
  presentActivity,
  presentSession,
  requestAccess,
} from "../privacy/access.js";

export function registerSessionRoutes(
  app: Express,
  db: Database,
  authConfig: AuthConfig,
): void {
  app.get("/api/sessions", async (req: Request, res: Response) => {
    const sourceId = optionalQueryString(req.query.sourceId);
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const offset = req.query.offset ? Number(req.query.offset) : undefined;
    const rows = await listSessions(db.raw(), { sourceId, limit, offset });
    const policy = resolvePrivacyPolicy();
    const { includeSensitive } = requestAccess(req, authConfig);
    res.json({
      success: true,
      sessions: rows.map((r) =>
        presentSession(
          rowToSessionSummary(r) as unknown as Record<string, unknown>,
          {
            includeSensitive,
            policy,
            listView: true,
          },
        ),
      ),
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
    const policy = resolvePrivacyPolicy();
    const { includeSensitive } = requestAccess(req, authConfig);
    const summary = rowToSessionSummary(session);
    res.json({
      success: true,
      session: {
        ...presentSession(summary as unknown as Record<string, unknown>, {
          includeSensitive,
          policy,
          listView: false,
        }),
        activities: activityRows.map((row) =>
          presentActivity(
            rowToActivity(row) as unknown as Record<string, unknown>,
            {
              // Timeline list: omit raw details/result for non-owners
              includeSensitive,
              policy,
            },
          ),
        ),
      },
    });
  });
}
