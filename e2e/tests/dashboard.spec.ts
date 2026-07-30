/**
 * Dashboard page E2E tests.
 * Tests stat cards, recent activity list, and the token trend chart.
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
    expect(titles).toContain("Tokens Today");
    expect(titles).toContain("API Spend (30d)");
    expect(titles).toContain("Failures (24h)");
    expect(titles).toContain("Source Health");
  });

  test("API Spend card navigates to Direct API Spend on Consumption", async ({
    page,
  }) => {
    await dashboard.clickApiSpendCard();
    await page.waitForURL(/\/consumption\?.*view=direct-api/);
    expect(page.url()).toContain("view=direct-api");
    await expect(
      page.getByRole("tab", { name: "Direct API Spend" }),
    ).toHaveAttribute("data-state", "active");
  });

  test("Tokens Today stat card shows a real value (not a loading placeholder)", async () => {
    const tokens = await dashboard.getStatValue("Tokens Today");
    expect(tokens).not.toBe("—");
    expect(parseInt(tokens.replace(/,/g, ""), 10)).toBeGreaterThanOrEqual(0);
  });

  test("Source Health shows a badge per seeded source", async () => {
    const badges = dashboard.getSourceHealthBadges();
    const count = await badges.count();
    // 5 sources are always seeded: claude-code, codex, hermes, lemonade, comfyui
    expect(count).toBeGreaterThanOrEqual(5);
  });

  test("shows recent activity list with items", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "Recent Activity" }),
    ).toBeVisible();

    // Should have activity rows (up to 5)
    const rows = dashboard.getRecentActivityRows();
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(5);
  });

  test("recent activity rows show description and status", async () => {
    const rows = dashboard.getRecentActivityRows();
    const firstRow = rows.first();

    // Each row should have a description containing our seeded text
    await expect(firstRow).toContainText("E2E test activity");
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

  test("shows Token Usage chart card", async ({ page }) => {
    await dashboard.waitForCharts();

    await expect(
      page.getByRole("heading", { name: "Token Usage" }),
    ).toBeVisible();

    // Chart should render an SVG (Recharts renders inside a ResponsiveContainer)
    const card = dashboard.getTokenUsageCard();
    await expect(card.locator("svg").first()).toBeVisible();
  });

  test("Failures (24h) stat card links to the Failures page", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "View failures" }).click();
    await page.waitForURL("/failures");
    expect(page.url()).toContain("/failures");
  });

  test("Failures (24h) shows server aggregate, not page length", async ({
    page,
  }) => {
    // Page fetches limit=5 rows; summary last24Hours is deliberately larger
    // so a saturated page cannot masquerade as the total.
    await page.route("**/api/failures**", async (route) => {
      const failures = Array.from({ length: 5 }, (_, i) => ({
        kind: "activity",
        id: `mock-fail-${i}`,
        sourceId: "claude-code",
        timestamp: new Date().toISOString(),
        summary: `Mock failure ${i}`,
      }));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          failures,
          summary: {
            total: 120,
            last24Hours: 42,
            openRuntimeEvents: 0,
            byKind: {
              activity: 100,
              inference_request: 15,
              runtime_event: 5,
            },
            definitions: {
              total: "all-time matching failures",
              last24Hours: "matching failures with timestamp >= now-24h",
              openRuntimeEvents:
                "runtime_events with severity != info and ended_at IS NULL",
              statusScope:
                "activity failure | inference non-success | runtime non-info",
            },
          },
        }),
      });
    });

    await dashboard.goto();
    await dashboard.waitForStats();

    const value = await dashboard.getStatValue("Failures (24h)");
    expect(value).toBe("42");
    expect(value).not.toBe("5");
    await expect(page.getByText(/Last 24 hours/i).first()).toBeVisible();
  });
});
