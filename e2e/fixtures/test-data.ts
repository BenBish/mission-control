/**
 * Test data factory functions for E2E tests.
 */

export const TEST_AGENTS = ["claude-opus", "claude-sonnet", "claude-haiku"];

export const TEST_SESSIONS = [
  "session-e2e-001",
  "session-e2e-002",
  "session-e2e-003",
  "session-e2e-004",
  "session-e2e-005",
];

export const TEST_CREDENTIALS = {
  username: "admin",
  password: "admin123",
};

export const TEST_URLS = {
  dashboard: "/",
  activities: "/activities",
  agents: "/agents",
  costs: "/costs",
  skills: "/skills",
  cron: "/cron",
  permissions: "/permissions",
} as const;

/** Human-readable labels for nav items as they appear in the sidebar */
export const NAV_ITEMS = [
  { label: "Dashboard", path: "/" },
  { label: "Activities", path: "/activities" },
  { label: "Agents", path: "/agents" },
  { label: "Cost Breakdown", path: "/costs" },
  { label: "Skills", path: "/skills" },
  { label: "Permissions", path: "/permissions" },
  { label: "Cron Jobs", path: "/cron" },
] as const;
