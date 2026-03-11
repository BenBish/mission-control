/**
 * Dashboard page E2E tests.
 * Tests stat cards, recent activity list, quick actions, and error states.
 */

import { test, expect } from "../fixtures/base.js";
import { DashboardPage } from "../page-objects/DashboardPage.js";

test.describe("Dashboard", () => {
  let dashboard: DashboardPage;

  test.beforeEach(async ({ page }) => {
    dashboard = new DashboardPage(page);
    await dashboard.goto();
    await dashboard.waitForStats();
  });

  test("displays all four stat cards", async () => {
    const titles = await dashboard.getStatCardTitles();
    expect(titles).toContain("Total Activities");
    expect(titles).toContain("Total Cost");
    expect(titles).toContain("Success Rate");
    expect(titles).toContain("Active Actors");
  });

  test("stat cards show real values (not loading placeholders)", async () => {
    // Total Activities should be a number > 0 (we seeded 60)
    const activities = await dashboard.getStatValue("Total Activities");
    expect(activities).not.toBe("—");
    expect(parseInt(activities.replace(/,/g, ""), 10)).toBeGreaterThan(0);

    // Total Cost should start with $
    const cost = await dashboard.getStatValue("Total Cost");
    expect(cost).toMatch(/^\$/);

    // Success Rate should end with %
    const rate = await dashboard.getStatValue("Success Rate");
    expect(rate).toMatch(/%$/);
  });

  test("shows recent activity list with items", async ({ page }) => {
    // Recent activity section should be visible
    await expect(
      page.getByRole("heading", { name: "Recent Activity" }),
    ).toBeVisible();

    // Should have activity rows (up to 5)
    const rows = dashboard.getRecentActivityRows();
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(5);
  });

  test("recent activity rows show description and status", async ({ page }) => {
    const rows = dashboard.getRecentActivityRows();
    const firstRow = rows.first();

    // Each row should have a description containing "E2E test activity"
    await expect(firstRow).toContainText("E2E test activity");

    // Each row should have a status text (success, failure, or pending)
    await expect(firstRow).toContainText(/success|failure|pending/);
  });

  test("clicking a recent activity navigates to detail", async ({ page }) => {
    const rows = dashboard.getRecentActivityRows();
    await rows.first().click();

    await page.waitForURL(/\/activities\/activity-e2e-/);
    expect(page.url()).toContain("/activities/activity-e2e-");
  });

  test('"View All" button navigates to activity feed', async ({ page }) => {
    await dashboard.getViewAllButton().click();
    await page.waitForURL("/activities");
    expect(page.url()).toContain("/activities");
  });

  test("quick actions section is visible with action buttons", async ({
    page,
  }) => {
    await expect(
      page.getByRole("heading", { name: "Quick Actions" }),
    ).toBeVisible();

    await expect(
      page.getByRole("button", { name: /View Activity Feed/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /View Cost Breakdown/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Open Real-time Stream/i }),
    ).toBeVisible();
  });

  test("quick action navigates to activity feed", async ({ page }) => {
    await dashboard.clickViewActivityFeed();
    await page.waitForURL("/activities");
    expect(page.url()).toContain("/activities");
  });

  test("quick action navigates to cost breakdown", async ({ page }) => {
    await dashboard.clickViewCostBreakdown();
    await page.waitForURL("/costs");
    expect(page.url()).toContain("/costs");
  });
});
