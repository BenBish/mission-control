/**
 * Agents page E2E tests.
 * Tests the agents listing page, including agent cards and page structure.
 *
 * Note: the E2E test seeder (db-seeder.ts) creates SOUL.md files for
 * claude-opus, claude-sonnet, and claude-haiku under $HOME/.openclaw/agents/,
 * so the agents list is never empty in this environment.
 */

import { test, expect } from "../fixtures/base.js";
import { AgentsPage } from "../page-objects/AgentsPage.js";

test.describe("Agents Page", () => {
  let agents: AgentsPage;

  test.beforeEach(async ({ page }) => {
    agents = new AgentsPage(page);
    await agents.goto();
    await agents.waitForContent();
  });

  test("renders page heading and description", async ({ page }) => {
    await expect(agents.heading).toBeVisible();
    await expect(
      page.getByText("View and manage all agents in the system"),
    ).toBeVisible();
  });

  test("shows search input", async () => {
    await expect(agents.searchInput).toBeVisible();
  });

  test("shows filter controls", async ({ page }) => {
    // Role, Model, Status, Sort filters
    await expect(page.getByText("Filters:")).toBeVisible();
  });

  test("displays seeded agents (not empty state)", async ({ page }) => {
    // The seeder creates claude-opus, claude-sonnet, claude-haiku agent files
    // so the page should list agents, not show the empty state.
    expect(await agents.hasEmptyState()).toBe(false);
    // At least one of the seeded agents should appear on the page
    await expect(
      page.getByText(/claude-opus|claude-sonnet|claude-haiku/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("does not show error state", async () => {
    expect(await agents.hasError()).toBe(false);
  });
});

test.describe("Agent Detail Page", () => {
  test("navigating to non-existent agent shows error state", async ({
    page,
  }) => {
    await page.goto("/agents/non-existent-agent");
    await page.waitForLoadState("domcontentloaded");
    await page.locator("main").waitFor({ state: "visible" });

    // Should show the error/not-found message
    await expect(
      page.getByText(/Agent not found|Error loading agent/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});
