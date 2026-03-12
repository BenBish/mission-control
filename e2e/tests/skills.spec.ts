/**
 * Skills page E2E tests.
 * Tests the skills registry page, including empty state and search.
 */

import { test, expect } from "../fixtures/base.js";
import { SkillsPage } from "../page-objects/SkillsPage.js";

test.describe("Skills Page", () => {
  let skills: SkillsPage;

  test.beforeEach(async ({ page }) => {
    skills = new SkillsPage(page);
    await skills.goto();
    await skills.waitForContent();
  });

  test("renders page heading and description", async ({ page }) => {
    await expect(skills.heading).toBeVisible();
    await expect(
      page.getByText("Browse and search available skills in the system"),
    ).toBeVisible();
  });

  test("shows search input", async () => {
    await expect(skills.searchInput).toBeVisible();
  });

  test("displays empty state when no skills exist", async () => {
    // Test environment has no skill files — should show empty state
    expect(await skills.hasEmptyState()).toBe(true);
  });

  test("does not show error state", async () => {
    expect(await skills.hasError()).toBe(false);
  });
});
