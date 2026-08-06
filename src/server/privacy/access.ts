/**
 * Request helpers for privacy-aware API responses.
 */

import type { Request } from "express";
import {
  type AuthConfig,
  type AuthUser,
  canViewSensitive,
  getRequestUser,
} from "../auth.js";
import {
  sanitizeActivityForClient,
  sanitizeSessionForClient,
} from "./redact.js";
import type { PrivacyPolicy } from "./policy.js";

export function requestAccess(
  req: Request,
  authConfig: AuthConfig,
): { user: AuthUser | null; includeSensitive: boolean } {
  const user = getRequestUser(req, authConfig);
  return {
    user,
    includeSensitive: canViewSensitive(user),
  };
}

export function presentActivity(
  activity: Record<string, unknown>,
  opts: { includeSensitive: boolean; policy: PrivacyPolicy },
): Record<string, unknown> {
  // List/default: always omit bulky sensitive JSON unless owner on detail
  return sanitizeActivityForClient(activity, {
    includeSensitive: opts.includeSensitive,
    hideRawCwd: opts.policy.hideRawCwdInLists,
  });
}

export function presentSession(
  session: Record<string, unknown>,
  opts: {
    includeSensitive: boolean;
    policy: PrivacyPolicy;
    /** When true (list endpoints), never emit raw cwd. */
    listView?: boolean;
  },
): Record<string, unknown> {
  // List views: always project alias only when policy asks (default).
  // Detail views: owners may see raw cwd; viewers never do.
  if (opts.listView) {
    return sanitizeSessionForClient(session, {
      includeSensitive: false,
      hideRawCwd: opts.policy.hideRawCwdInLists,
    });
  }
  return sanitizeSessionForClient(session, {
    includeSensitive: opts.includeSensitive,
    hideRawCwd: !opts.includeSensitive,
  });
}
