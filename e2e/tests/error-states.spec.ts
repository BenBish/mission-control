/**
 * Error state E2E tests.
 * Tests that error and not-found states are handled gracefully.
 */

import { test, expect } from "../fixtures/base.js";

test.describe("Error States", () => {
  test("non-existent activity shows not-found state", async ({ page }) => {
    await page.goto("/activities/does-not-exist-12345");
    await page.waitForLoadState("domcontentloaded");
    await page.locator("main").waitFor({ state: "visible" });

    // Should show a not-found or error message
    await expect(
      page.getByText(/not found|no activity|error/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("unknown routes redirect to dashboard", async ({ page }) => {
    await page.goto("/this-page-does-not-exist");
    await page.waitForLoadState("domcontentloaded");

    // Catch-all route redirects to "/"
    await page.waitForURL("/");

    // Wait for dashboard to render
    await expect(
      page.getByRole("heading", { name: "Dashboard", level: 1 }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("activities page handles empty ID gracefully", async ({ page }) => {
    await page.goto("/activities/");
    await page.waitForLoadState("domcontentloaded");
    await page.locator("main").waitFor({ state: "visible" });

    // Should show either the activity feed list or the detail page — not crash
    await expect(
      page
        .locator("main h1, main h2, main table, main [class*='card']")
        .first(),
    ).toBeVisible({ timeout: 15_000 });
  });
});
