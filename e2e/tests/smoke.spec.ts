/**
 * Smoke tests — verify the app loads and core elements are visible.
 */

import { test, expect } from "@playwright/test";
import { BasePage } from "../page-objects/BasePage.js";
import { Sidebar } from "../page-objects/Sidebar.js";

test.describe("Smoke Tests", () => {
  test("app loads and displays the dashboard", async ({ page }) => {
    const basePage = new BasePage(page);
    await basePage.goto("/");

    // Page should load without errors
    await expect(page).toHaveURL(/\/$/);

    // Main content area should be visible
    await expect(basePage.mainContent).toBeVisible();
  });

  test("sidebar is visible with navigation links", async ({ page }) => {
    const sidebar = new Sidebar(page);
    await page.goto("/");
    await page.locator("main").waitFor({ state: "visible" });

    // Sidebar should be visible
    await expect(sidebar.nav).toBeVisible();

    // Should have nav links
    const links = await sidebar.getVisibleNavLinks();
    expect(links.length).toBeGreaterThan(0);

    // Key nav items should exist
    await expect(sidebar.getNavLink("Dashboard")).toBeVisible();
    await expect(sidebar.getNavLink("Activities")).toBeVisible();
    await expect(sidebar.getNavLink("Sessions")).toBeVisible();
  });

  test("dashboard renders content after loading", async ({ page }) => {
    await page.goto("/");

    // Wait for dashboard content to appear (not just the loading spinner)
    // Dashboard should eventually show headings, cards, or text
    await expect(
      page.locator("main").locator("h1, h2, h3, [class*='card'], a").first(),
    ).toBeVisible({ timeout: 15_000 });

    const main = page.locator("main");
    const textContent = await main.textContent();
    expect(textContent!.length).toBeGreaterThan(0);
  });

  test("health endpoint returns 200", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);
  });
});
