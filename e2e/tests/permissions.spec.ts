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
    // The component renders one of three states:
    //   - matrix with agent rows (agents + skills present)
    //   - "No skills configured." (agents present, no skills)
    //   - "No agents or skills found." (neither present)
    // All three are valid in CI. Use domcontentloaded — networkidle never fires
    // because the SSE stream keeps the connection open.
    await page.waitForLoadState("domcontentloaded");
    await page
      .locator("main")
      .getByRole("heading", { name: "Permissions Matrix" })
      .waitFor({ state: "visible", timeout: 10_000 });
    // Any of the three valid states satisfies this test
    const hasMatrix = await page
      .getByText(/claude-opus|claude-sonnet|claude-haiku/i)
      .first()
      .isVisible()
      .catch(() => false);
    const hasNoSkills = await page
      .getByText("No skills configured.")
      .isVisible()
      .catch(() => false);
    const hasEmpty = await page
      .getByText(/No agents or skills found/)
      .isVisible()
      .catch(() => false);
    expect(hasMatrix || hasNoSkills || hasEmpty).toBe(true);
  });

  test("does not show error state", async ({ page }) => {
    await expect(
      page.getByText("Error loading permissions matrix"),
    ).not.toBeVisible();
  });
});
