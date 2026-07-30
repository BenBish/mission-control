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

/**
 * Mobile viewport regression (BSH-67): Dashboard must not introduce horizontal
 * page scroll at 390×844. Long activity text and the Token Usage chart are the
 * historical overflow sources — both must stay within the document width.
 */
test.describe("Dashboard mobile overflow", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  const LONG_DESCRIPTION =
    "E2E long activity description that would force horizontal overflow if the row cannot shrink: " +
    "abcdefghijklmnopqrstuvwxyz-".repeat(20);

  test("no horizontal document overflow with long activity text and token chart", async ({
    page,
  }) => {
    // Seed a deliberately long description so truncation/shrink constraints
    // are exercised — short seeded copy can hide the regression.
    await page.route("**/api/activities**", async (route) => {
      const url = new URL(route.request().url());
      // Only intercept list requests (not /api/activities/:id).
      if (url.pathname !== "/api/activities") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          activities: [
            {
              id: "activity-e2e-long-0",
              sourceId: "claude-code",
              instanceId: "claude-code@arch-desktop",
              sessionId: "claude-code:session-e2e-cc-001",
              timestamp: new Date().toISOString(),
              actor: { type: "agent", id: "assistant" },
              actionType: "tool_call",
              description: LONG_DESCRIPTION,
              status: "success",
              inputTokens: 100,
              outputTokens: 50,
              totalTokens: 150,
            },
          ],
        }),
      });
    });

    const dashboard = new DashboardPage(page);
    await dashboard.goto();
    await dashboard.waitForStats();
    await dashboard.waitForCharts();

    await expect(
      page.getByRole("heading", { name: "Dashboard", level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Recent Activity" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Token Usage" }),
    ).toBeVisible();

    // Long text must appear (truncated) in Recent Activity without expanding
    // the document width.
    const recentCard = page
      .locator("div")
      .filter({
        has: page.getByRole("heading", { name: "Recent Activity" }),
      })
      .first();
    await expect(recentCard).toContainText("E2E long activity description");

    const metrics = await page.evaluate(() => {
      const docEl = document.documentElement;
      const body = document.body;
      const scrollWidth = Math.max(docEl.scrollWidth, body?.scrollWidth ?? 0);
      const clientWidth = docEl.clientWidth;
      const innerWidth = window.innerWidth;

      const tokenHeading = Array.from(document.querySelectorAll("h3")).find(
        (h) => h.textContent?.trim() === "Token Usage",
      );
      const tokenCard = tokenHeading?.closest(
        "div.rounded-lg, [class*='rounded-lg']",
      ) as HTMLElement | null;
      const chartSvg = tokenCard?.querySelector("svg") as SVGElement | null;

      const chartWidth = chartSvg ? chartSvg.getBoundingClientRect().width : 0;
      const cardWidth = tokenCard ? tokenCard.getBoundingClientRect().width : 0;

      return {
        scrollWidth,
        clientWidth,
        innerWidth,
        chartWidth,
        cardWidth,
        hasChart: !!chartSvg,
      };
    });

    // Allow 1px subpixel rounding; document must not meaningfully scroll sideways.
    expect(
      metrics.scrollWidth,
      `document scrollWidth (${metrics.scrollWidth}) exceeded viewport (${metrics.innerWidth})`,
    ).toBeLessThanOrEqual(metrics.innerWidth + 1);

    expect(metrics.hasChart).toBe(true);
    expect(metrics.chartWidth).toBeGreaterThan(0);
    expect(
      metrics.chartWidth,
      `chart width (${metrics.chartWidth}) exceeded card (${metrics.cardWidth})`,
    ).toBeLessThanOrEqual(metrics.cardWidth + 1);
    expect(metrics.cardWidth).toBeLessThanOrEqual(metrics.innerWidth + 1);
  });
});
