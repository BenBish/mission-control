/**
 * Consumption page E2E tests (src/pages/Consumption.tsx).
 * Agent Usage vs Direct API Spend tabs, URL-encoded view/range,
 * and dataset-scoped empty states.
 */

import { test, expect } from "../fixtures/base.js";
import { ConsumptionPage } from "../page-objects/ConsumptionPage.js";

test.describe("Consumption", () => {
  let consumption: ConsumptionPage;

  test.beforeEach(async ({ page }) => {
    consumption = new ConsumptionPage(page);
    await consumption.goto();
    await consumption.waitForData();
  });

  test("displays page heading", async () => {
    await expect(consumption.heading).toBeVisible();
  });

  test("shows all four data-class tabs", async () => {
    await expect(consumption.getTab("Agent Usage")).toBeVisible();
    await expect(consumption.getTab("Plan usage & wallet")).toBeVisible();
    await expect(consumption.getTab("Direct API Spend")).toBeVisible();
    await expect(consumption.getTab("Attribution")).toBeVisible();
  });

  test("defaults to Tokens unit with real stat values on Agent Usage", async () => {
    const tokens = await consumption.getStatValue("Total Tokens");
    expect(tokens).not.toBe("");
    expect(parseInt(tokens.replace(/,/g, ""), 10)).toBeGreaterThan(0);
  });

  test("Ranked drivers table lists seeded activity", async () => {
    const rows = consumption.getModelRows();
    await expect(rows.first()).toBeVisible();
    await expect(rows).not.toHaveCount(0);
  });

  test("shows unattributed coverage and dimension switches", async ({
    page,
  }) => {
    await expect(consumption.getCoverageUnattributed()).toBeVisible();
    await consumption.getDimensionButton("Project").click();
    await expect(
      page.getByRole("heading", { name: "Ranked drivers", level: 3 }),
    ).toBeVisible();
    await consumption.getDimensionButton("Model").click();
  });

  test("switching to USD unit shows agent-scoped empty state", async () => {
    await consumption.selectUnit("USD");
    await expect(consumption.agentUsdEmptyState()).toBeVisible();
    // Points operators at Direct API Spend instead of implying zero account spend
    await expect(
      consumption.page.getByRole("button", { name: "Direct API Spend" }),
    ).toBeVisible();
  });

  test("switching to Compute time unit updates the stat card", async () => {
    await consumption.selectUnit("Compute time");
    await expect(
      consumption.page.getByRole("heading", { name: "Compute Time", level: 3 }),
    ).toBeVisible();
  });

  test("date presets are clickable and change the displayed range", async ({
    page,
  }) => {
    await consumption.selectPreset("Today");
    await expect(page.getByText("Showing: Today")).toBeVisible();
    await expect(page).toHaveURL(/range=today/);

    await consumption.selectPreset("All time");
    await expect(page.getByText("Showing: All time")).toBeVisible();
    await expect(page).toHaveURL(/range=all/);
  });

  test("view and range are encoded in the URL", async ({ page }) => {
    await consumption.selectTab("Direct API Spend");
    await expect(page).toHaveURL(/view=direct-api/);
    await expect(
      page.getByRole("heading", { name: "Direct API Spend", level: 3 }),
    ).toBeVisible();
    await expect(page.getByText("Account-wide").first()).toBeVisible();
    // Direct API Spend keeps only API organization spend content.
    await expect(page.getByTestId("direct-api-overview")).toBeVisible();
    await expect(page.getByTestId("direct-api-drivers")).toBeVisible();
    await expect(page.getByTestId("plan-wallet-capacity-section")).toHaveCount(
      0,
    );

    await consumption.selectPreset("Last 7 days");
    await expect(page).toHaveURL(/range=7d/);
  });

  test("deep-link opens Direct API Spend with range", async ({ page }) => {
    await consumption.goto("?view=direct-api&range=30d");
    await consumption.waitForData();
    await expect(page).toHaveURL(/view=direct-api/);
    await expect(page).toHaveURL(/range=30d/);
    await expect(consumption.getTab("Direct API Spend")).toHaveAttribute(
      "data-state",
      "active",
    );
  });

  test("Attribution tab shows reconciliation summary", async ({ page }) => {
    await consumption.selectTab("Attribution");
    await expect(page).toHaveURL(/view=attribution/);
    await expect(page.getByTestId("attribution-panel")).toBeVisible();
    await expect(page.getByTestId("attribution-summary")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Matched spend", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Coverage", exact: true }),
    ).toBeVisible();
  });

  test("source filter shows account-wide note on Direct API Spend", async ({
    page,
  }) => {
    await consumption.selectSourceFilter("Claude Code");
    await consumption.selectTab("Direct API Spend");
    await expect(page.getByText("Account-wide").first()).toBeVisible();
    await expect(
      page.getByText(/Source filter “Claude Code” does not apply here/i),
    ).toBeVisible();
    // Cleanup so later tests (same browser context) aren't source-scoped
    await consumption.selectAllSourcesFilter();
  });

  test("separates plan and wallet capacity from Direct API Spend", async ({
    page,
  }) => {
    await consumption.selectTab("Direct API Spend");
    const overview = page.getByTestId("direct-api-overview");
    await expect(overview).toBeVisible();
    await expect(overview.getByText("MTD spent")).toBeVisible();
    await expect(page.getByTestId("provider-plan-usage-card")).toHaveCount(0);
    await expect(page.getByTestId("provider-wallet-card")).toHaveCount(0);

    await consumption.selectTab("Plan usage & wallet");
    await expect(page).toHaveURL(/view=plan-wallet/);
    const connectors = page.getByTestId("plan-wallet-capacity-health");
    await expect(
      page.getByTestId("plan-wallet-capacity-section"),
    ).toBeVisible();
    await expect(page.getByTestId("provider-plan-usage-card")).toBeVisible();
    await expect(page.getByTestId("provider-wallet-card")).toBeVisible();
    await expect(connectors).not.toHaveAttribute("open", "");
    await expect(connectors.locator("summary")).toContainText(
      "Connectors & data health",
    );
    await connectors.locator("summary").click();
    await expect(connectors).toHaveAttribute("open", "");
  });

  test("redirects the legacy Direct API capacity deep link", async ({
    page,
  }) => {
    await consumption.goto("?view=direct-api&range=30d#capacity");
    await consumption.waitForData();
    await expect(page).toHaveURL(/view=plan-wallet/);
    await expect(consumption.getTab("Plan usage & wallet")).toHaveAttribute(
      "data-state",
      "active",
    );
    await expect(
      page.getByTestId("plan-wallet-capacity-section"),
    ).toBeVisible();
  });

  test("Direct API Spend has no page-wide overflow at 390px", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await consumption.goto("?view=direct-api&range=30d");
    await consumption.waitForData();
    await expect(page.getByTestId("direct-api-overview")).toBeVisible();
    await expect(page.getByText("MTD spent")).toBeVisible();
    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      return {
        scrollWidth: doc.scrollWidth,
        clientWidth: doc.clientWidth,
      };
    });
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
  });

  test("Plan usage & wallet has no page-wide overflow at 390px", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await consumption.goto("?view=plan-wallet&range=30d");
    await consumption.waitForData();
    await expect(
      page.getByTestId("plan-wallet-capacity-section"),
    ).toBeVisible();
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
  });
});
