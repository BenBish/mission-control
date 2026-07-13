/**
 * Test data factory functions for E2E tests.
 */

import { TEST_SESSIONS as SEEDED_SESSIONS } from "../helpers/db-seeder.js";

/** Full session IDs as ingested (source-prefixed) — derived from the same
 *  data the seeder writes so this can't drift. */
export const TEST_SESSIONS = [
  ...SEEDED_SESSIONS.claudeCode.map((id) => `claude-code:${id}`),
  ...SEEDED_SESSIONS.codex.map((id) => `codex:${id}`),
];

export const TEST_CREDENTIALS = {
  username: "admin",
  password: "admin123",
};

export const TEST_URLS = {
  dashboard: "/",
  activities: "/activities",
  sessions: "/sessions",
  runtime: "/runtime",
  failures: "/failures",
  consumption: "/consumption",
  jobs: "/jobs",
  settings: "/settings",
} as const;

/** Human-readable labels for nav items as they appear in the sidebar */
export const NAV_ITEMS = [
  { label: "Dashboard", path: "/" },
  { label: "Activities", path: "/activities" },
  { label: "Sessions", path: "/sessions" },
  { label: "Runtime", path: "/runtime" },
  { label: "Failures", path: "/failures" },
  { label: "Consumption", path: "/consumption" },
  { label: "Jobs", path: "/jobs" },
  { label: "Settings", path: "/settings" },
] as const;
