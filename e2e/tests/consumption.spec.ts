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

  test("shows Agent Usage, Direct API Spend, and Attribution tabs", async () => {
    await expect(consumption.getTab("Agent Usage")).toBeVisible();
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
    // BSH-98: decision sections first; BYOK caveat lives under Capacity details
    await expect(page.getByTestId("direct-api-overview")).toBeVisible();
    await expect(page.getByTestId("direct-api-drivers")).toBeVisible();
    await page
      .getByTestId("direct-api-capacity-health")
      .locator("summary")
      .click();
    await expect(page.getByText(/OpenRouter BYOK/i)).toBeVisible();

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

  test("Direct API Spend shows overview before capacity diagnostics", async ({
    page,
  }) => {
    await consumption.selectTab("Direct API Spend");
    const overview = page.getByTestId("direct-api-overview");
    const planWallet = page.getByTestId("direct-api-capacity-section");
    const connectors = page.getByTestId("direct-api-capacity-health");
    await expect(overview).toBeVisible();
    await expect(planWallet).toBeVisible();
    await expect(connectors).toBeVisible();
    // Overview appears above plan usage & wallet, then connectors accordion
    const order = await page.evaluate(() => {
      const o = document.querySelector('[data-testid="direct-api-overview"]');
      const p = document.querySelector(
        '[data-testid="direct-api-capacity-section"]',
      );
      const c = document.querySelector(
        '[data-testid="direct-api-capacity-health"]',
      );
      if (!o || !p || !c) return null;
      const oBeforeP =
        o.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING;
      const pBeforeC =
        p.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING;
      return oBeforeP && pBeforeC
        ? "overview-before-plan-before-connectors"
        : "unexpected-order";
    });
    expect(order).toBe("overview-before-plan-before-connectors");
    // MTD / budget cards live in overview
    await expect(overview.getByText("MTD spent")).toBeVisible();
    // Plan usage is promoted (always visible); connector health stays collapsed
    await expect(page.getByTestId("provider-plan-usage-card")).toBeVisible();
    await expect(page.getByTestId("provider-wallet-card")).toBeVisible();
    await expect(connectors).not.toHaveAttribute("open", "");
    await expect(connectors.locator("summary")).toContainText(
      "Connectors & data health",
    );
    await connectors.locator("summary").click();
    await expect(connectors).toHaveAttribute("open", "");
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
});
