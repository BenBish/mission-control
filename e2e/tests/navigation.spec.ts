/**
 * Navigation tests — verify sidebar links navigate correctly and URL routing works.
 */

import { test, expect } from "@playwright/test";
import { Sidebar } from "../page-objects/Sidebar.js";
import { NAV_ITEMS } from "../fixtures/test-data.js";

test.describe("Navigation", () => {
  test("all sidebar nav links navigate to correct pages", async ({ page }) => {
    const sidebar = new Sidebar(page);
    await page.goto("/");
    await page.locator("main").waitFor({ state: "visible" });

    for (const item of NAV_ITEMS) {
      await sidebar.navigateTo(item.label);

      // URL should match expected path
      const url = new URL(page.url());
      expect(url.pathname).toBe(item.path);

      // Page content should be visible
      await expect(page.locator("main")).toBeVisible();
    }
  });

  test("direct URL routing works for each page", async ({ page }) => {
    for (const item of NAV_ITEMS) {
      await page.goto(item.path);
      await page.locator("main").waitFor({ state: "visible" });

      const url = new URL(page.url());
      expect(url.pathname).toBe(item.path);
      await expect(page.locator("main")).toBeVisible();
    }
  });

  test("browser back/forward navigation works", async ({ page }) => {
    const sidebar = new Sidebar(page);
    await page.goto("/");
    await page.locator("main").waitFor({ state: "visible" });

    // Navigate to Activities
    await sidebar.navigateTo("Activities");
    expect(new URL(page.url()).pathname).toBe("/activities");

    // Navigate to Agents
    await sidebar.navigateTo("Agents");
    expect(new URL(page.url()).pathname).toBe("/agents");

    // Go back to Activities
    await page.goBack();
    await page.locator("main").waitFor({ state: "visible" });
    expect(new URL(page.url()).pathname).toBe("/activities");

    // Go back to Dashboard
    await page.goBack();
    await page.locator("main").waitFor({ state: "visible" });
    expect(new URL(page.url()).pathname).toBe("/");

    // Go forward to Activities
    await page.goForward();
    await page.locator("main").waitFor({ state: "visible" });
    expect(new URL(page.url()).pathname).toBe("/activities");
  });
});
