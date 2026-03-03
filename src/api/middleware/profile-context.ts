/**
 * Profile Context Middleware
 * Extracts the `?profile=<name>` query parameter from each request and
 * attaches it to `req.profileId`. Defaults to "default" when omitted.
 *
 * Validates profile IDs: alphanumeric, hyphens, underscores only, max 50 chars.
 * The special value "all" is allowed for cross-profile aggregation.
 */

import type { Request, Response, NextFunction } from "express";

/** Valid profile ID pattern: alphanumeric, hyphens, underscores, 1-50 chars */
const PROFILE_ID_RE = /^[a-zA-Z0-9_-]{1,50}$/;

/**
 * Augment Express Request with profileId.
 */
declare global {
  namespace Express {
    interface Request {
      /** The active profile ID extracted from ?profile= query param */
      profileId: string;
    }
  }
}

/**
 * Express middleware that extracts and validates the `?profile=` query parameter.
 *
 * - If `?profile=` is missing or empty, defaults to `"default"`
 * - If `?profile=all`, sets profileId to `"all"` (for cross-profile queries)
 * - If the value contains special characters or exceeds 50 chars, returns 400
 */
export function profileContextMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const profileParam = req.query.profile as string | undefined;

  if (!profileParam) {
    req.profileId = "default";
    return next();
  }

  // Validate
  if (!PROFILE_ID_RE.test(profileParam)) {
    res.status(400).json({
      success: false,
      error: `Invalid profile ID: must be alphanumeric, hyphens, or underscores, max 50 characters`,
    });
    return;
  }

  req.profileId = profileParam;
  next();
}
