/**
 * Agents page E2E tests.
 * Tests the agents listing page, including empty state and page structure.
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

  test("displays empty state when no agents exist", async () => {
    // Test environment has no agent files — should show empty state
    expect(await agents.hasEmptyState()).toBe(true);
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
