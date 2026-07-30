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
    expect(titles).toContain("Direct API Spend");
    expect(titles).toContain("Failures (24h)");
    expect(titles).toContain("Source Health");
  });

  test("Direct API Spend card navigates to provider billing for today", async ({
    page,
  }) => {
    await dashboard.clickDirectApiSpendCard();
    await page.waitForURL(/\/consumption\?.*view=direct-api/);
    expect(page.url()).toContain("view=direct-api");
    expect(page.url()).toContain("range=today");
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
 * Direct API Spend card states (BSH-69).
 * Provider billing is mocked so empty / stale / error never depend on live keys.
 */
test.describe("Dashboard Direct API Spend states", () => {
  type ProviderStatusMock = {
    id: string;
    name: string;
    configured: boolean;
    envVars: string[];
    notes: string | null;
    status: string;
    lastSyncAt: string | null;
    lastSuccessAt: string | null;
    lastError: string | null;
    limitation: string | null;
    cursorDay: string | null;
  };

  function baseProvider(
    overrides: Partial<ProviderStatusMock> = {},
  ): ProviderStatusMock {
    return {
      id: "openrouter",
      name: "OpenRouter",
      configured: true,
      envVars: ["OPENROUTER_API_KEY"],
      notes: null,
      status: "ok",
      lastSyncAt: new Date().toISOString(),
      lastSuccessAt: new Date().toISOString(),
      lastError: null,
      limitation: null,
      cursorDay: null,
      ...overrides,
    };
  }

  async function mockProviderApis(
    page: import("@playwright/test").Page,
    opts: {
      todayCost: number | null;
      days30Cost: number | null;
      providers: ProviderStatusMock[];
    },
  ) {
    await page.route("**/api/providers/status**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, providers: opts.providers }),
      });
    });

    await page.route("**/api/providers/usage/breakdown**", async (route) => {
      const url = new URL(route.request().url());
      const since = url.searchParams.get("since");
      const sinceMs = since ? Date.parse(since) : 0;
      // Today window starts at local midnight (≤ ~24h ago); 30d is ~30 days ago.
      const isTodayWindow = Date.now() - sinceMs < 36 * 60 * 60 * 1000;
      const cost = isTodayWindow ? opts.todayCost : opts.days30Cost;
      const breakdown =
        cost == null
          ? []
          : [
              {
                provider: "openrouter",
                model: "test-model",
                input_tokens: 100,
                output_tokens: 50,
                cost_usd: cost,
                request_count: 1,
              },
            ];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          source: "provider-api",
          breakdown,
        }),
      });
    });
  }

  test("populated: shows today + 30d + last sync", async ({ page }) => {
    await mockProviderApis(page, {
      todayCost: 1.095,
      days30Cost: 7.9466,
      providers: [baseProvider()],
    });

    const dashboard = new DashboardPage(page);
    await dashboard.goto();
    await dashboard.waitForStats();

    await expect(dashboard.getDirectApiSpendToday()).toHaveText("$1.0950");
    await expect(dashboard.getDirectApiSpendMeta()).toContainText(
      "30d $7.9466",
    );
    await expect(dashboard.getDirectApiSpendSync()).toContainText(/Synced/i);
    await expect(
      page.getByText(/Account-wide · independent of source filter/i),
    ).toBeVisible();
  });

  test("empty: never synced shows No synced spend (not $0)", async ({
    page,
  }) => {
    await mockProviderApis(page, {
      todayCost: null,
      days30Cost: null,
      providers: [
        baseProvider({
          configured: false,
          status: "not_configured",
          lastSyncAt: null,
          lastSuccessAt: null,
        }),
      ],
    });

    const dashboard = new DashboardPage(page);
    await dashboard.goto();
    await dashboard.waitForStats();

    await expect(dashboard.getDirectApiSpendToday()).toHaveText(
      "No synced spend",
    );
    await expect(dashboard.getDirectApiSpendToday()).not.toHaveText("$0.0000");
    await expect(dashboard.getDirectApiSpendMeta()).toContainText("30d —");
    await expect(dashboard.getDirectApiSpendSync()).toHaveText("Not synced");
  });

  test("true zero after sync is distinguishable from missing data", async ({
    page,
  }) => {
    await mockProviderApis(page, {
      todayCost: null,
      days30Cost: null,
      providers: [baseProvider()],
    });

    const dashboard = new DashboardPage(page);
    await dashboard.goto();
    await dashboard.waitForStats();

    await expect(dashboard.getDirectApiSpendToday()).toHaveText("$0.0000");
    await expect(dashboard.getDirectApiSpendMeta()).toContainText(
      "30d $0.0000",
    );
    await expect(dashboard.getDirectApiSpendSync()).toContainText(/Synced/i);
  });

  test("stale sync is labeled when last success is old", async ({ page }) => {
    const staleAt = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    await mockProviderApis(page, {
      todayCost: 0.5,
      days30Cost: 3.25,
      providers: [
        baseProvider({
          lastSuccessAt: staleAt,
          lastSyncAt: staleAt,
          status: "ok",
        }),
      ],
    });

    const dashboard = new DashboardPage(page);
    await dashboard.goto();
    await dashboard.waitForStats();

    await expect(dashboard.getDirectApiSpendToday()).toHaveText("$0.5000");
    await expect(dashboard.getDirectApiSpendSync()).toHaveText("Stale sync");
  });

  test("connector error is labeled and does not look like zero", async ({
    page,
  }) => {
    await mockProviderApis(page, {
      todayCost: 2.5,
      days30Cost: 9.0,
      providers: [
        baseProvider({
          status: "error",
          lastError: "Admin key rejected",
          lastSuccessAt: new Date().toISOString(),
        }),
      ],
    });

    const dashboard = new DashboardPage(page);
    await dashboard.goto();
    await dashboard.waitForStats();

    await expect(dashboard.getDirectApiSpendToday()).toHaveText("$2.5000");
    await expect(dashboard.getDirectApiSpendSync()).toHaveText("Sync error");
    await expect(dashboard.getDirectApiSpendSync()).toHaveAttribute(
      "title",
      "Admin key rejected",
    );
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

    await expect(dashboard.heading).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Recent Activity" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Token Usage" }),
    ).toBeVisible();

    // Long text must appear (truncated) in Recent Activity without expanding
    // the document width.
    await expect(dashboard.getRecentActivityCard()).toContainText(
      "E2E long activity description",
    );

    const metrics = await dashboard.getOverflowLayoutMetrics();

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
