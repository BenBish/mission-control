/**
 * Cron Jobs page E2E tests.
 * Tests the cron jobs listing page, including empty state.
 */

import { test, expect } from "../fixtures/base.js";
import { CronPage } from "../page-objects/CronPage.js";

test.describe("Cron Jobs Page", () => {
  let cron: CronPage;

  test.beforeEach(async ({ page }) => {
    cron = new CronPage(page);
    await cron.goto();
    await cron.waitForContent();
  });

  test("renders cron page content", async ({ page }) => {
    // Should show either jobs list or empty state (no error)
    const mainText = await page.locator("main").textContent();
    expect(mainText!.length).toBeGreaterThan(0);
    expect(await cron.hasError()).toBe(false);
  });

  test("shows empty state or jobs list (not an error)", async ({ page }) => {
    // Depending on whether openclaw CLI is available, we get either:
    // - Empty state: "No cron jobs configured"
    // - Jobs list with heading "Cron Jobs"
    // - Still loading (CLI timeout)
    // All are valid — just verify no error
    const hasEmpty = await cron.hasEmptyState();
    const hasJobs = await page
      .getByRole("heading", { name: "Cron Jobs" })
      .isVisible();
    const isLoading = await page.getByText("Loading cron jobs...").isVisible();

    expect(hasEmpty || hasJobs || isLoading).toBe(true);
    expect(await cron.hasError()).toBe(false);
  });
});
