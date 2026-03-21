/**
 * Permissions page E2E tests.
 * Tests the permissions matrix page structure and content.
 *
 * Note: the E2E seeder creates agent files, so agents will be present.
 * Skills depend on openclaw being installed on the runner; the matrix may
 * render with agents only, or show an empty state if no skills are found.
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

  test("renders permissions matrix or empty state", async ({ page }) => {
    // The seeder creates agent files (claude-opus, claude-sonnet, claude-haiku),
    // but skills are only present if openclaw skills are installed on the runner.
    // Either the matrix renders with agents, or the empty state is shown — both are valid.
    await page.waitForLoadState("networkidle");
    const hasMatrix = await page
      .getByText(/claude-opus|claude-sonnet|claude-haiku/i)
      .first()
      .isVisible()
      .catch(() => false);
    const hasEmpty = await page
      .getByText(/No agents or skills found/)
      .isVisible()
      .catch(() => false);
    expect(hasMatrix || hasEmpty).toBe(true);
  });

  test("does not show error state", async ({ page }) => {
    await expect(
      page.getByText("Error loading permissions matrix"),
    ).not.toBeVisible();
  });
});
