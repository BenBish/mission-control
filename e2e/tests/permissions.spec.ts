/**
 * Permissions page E2E tests.
 * Tests the permissions matrix page, including empty state.
 */

import { test, expect } from "../fixtures/base.js";
import { BasePage } from "../page-objects/BasePage.js";

test.describe("Permissions Page", () => {
  test.beforeEach(async ({ page }) => {
    const basePage = new BasePage(page);
    await basePage.goto("/permissions");
  });

  test("renders page heading and description", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "Permissions Matrix", level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByText("Visual overview of agent skill access across the system"),
    ).toBeVisible();
  });

  test("shows empty state when no agents or skills exist", async ({ page }) => {
    // Test environment has no agents/skills — should show empty state
    await expect(page.getByText(/No agents or skills found/)).toBeVisible();
  });

  test("does not show error state", async ({ page }) => {
    await expect(
      page.getByText("Error loading permissions matrix"),
    ).not.toBeVisible();
  });
});
