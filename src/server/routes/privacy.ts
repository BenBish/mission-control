/**
 * Privacy / security configuration and purge endpoints (BSH-100).
 * Owner-only for mutations; policy snapshot is readable by any authenticated user.
 */

import type { Express, Request, Response } from "express";
import type { Database } from "../../db/database.js";
import { type AuthConfig, requireOwner, getRequestUser } from "../auth.js";
import {
  resolvePrivacyPolicy,
  privacyPolicyPublicSnapshot,
  checkProductionAuthPolicy,
} from "../privacy/policy.js";
import {
  runDataClassRetention,
  purgeSensitiveStoredFields,
} from "../../db/queries/retention.js";

export function registerPrivacyRoutes(
  app: Express,
  db: Database,
  authConfig: AuthConfig,
): void {
  /**
   * GET /api/privacy/policy
   * Public (auth-gated when auth on) snapshot of security-relevant config.
   * Never includes secrets or password hashes.
   */
  app.get("/api/privacy/policy", async (req: Request, res: Response) => {
    try {
      const policy = resolvePrivacyPolicy();
      const user = getRequestUser(req, authConfig);
      const snapshot = privacyPolicyPublicSnapshot(policy, {
        enabled: authConfig.enabled,
        hasViewer: Boolean(authConfig.viewerUsername),
      });
      const authCheck = checkProductionAuthPolicy(policy, authConfig.enabled);

      res.json({
        success: true,
        policy: snapshot,
        user: user ? { username: user.username, role: user.role } : null,
        warnings: authCheck.ok && authCheck.warning ? [authCheck.warning] : [],
      });
    } catch (err) {
      console.error("GET /api/privacy/policy failed:", err);
      res.status(500).json({
        success: false,
        error: "Failed to load privacy policy",
      });
    }
  });

  /**
   * POST /api/privacy/retention/run
   * Owner-only: run data-class retention purge now (also runs on a schedule).
   */
  app.post(
    "/api/privacy/retention/run",
    requireOwner(authConfig),
    async (_req: Request, res: Response) => {
      try {
        const policy = resolvePrivacyPolicy();
        const result = await runDataClassRetention(db.raw(), policy.retention);
        res.json({ success: true, result });
      } catch (err) {
        console.error("POST /api/privacy/retention/run failed:", err);
        res.status(500).json({
          success: false,
          error: "Retention purge failed",
        });
      }
    },
  );

  /**
   * POST /api/privacy/purge-sensitive
   * Owner-only: one-shot scrub of already-stored sensitive activity fields.
   * Body: { strict?: boolean }
   *
   * Documented migration path for data ingested before redaction existed.
   */
  app.post(
    "/api/privacy/purge-sensitive",
    requireOwner(authConfig),
    async (req: Request, res: Response) => {
      try {
        const strict = req.body?.strict === true;
        const result = await purgeSensitiveStoredFields(db.raw(), { strict });
        res.json({
          success: true,
          result,
          note:
            "Existing activity details/results were nullified. " +
            "Re-ingest will re-apply current redaction policy. " +
            "See docs/DEPLOYMENT.md (Privacy & access).",
        });
      } catch (err) {
        console.error("POST /api/privacy/purge-sensitive failed:", err);
        res.status(500).json({
          success: false,
          error: "Sensitive purge failed",
        });
      }
    },
  );
}
