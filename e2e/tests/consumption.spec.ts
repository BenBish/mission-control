/**
 * Consumption page E2E tests (src/pages/Consumption.tsx).
 * Replaces the old Cost Breakdown tests — unit switcher (Tokens/Compute/USD),
 * date presets, and the honest USD empty state (no source has cost_usd
 * populated for seeded data, since none of Claude Code/Codex/Hermes/
 * Lemonade/ComfyUI are billable sources here).
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

  test("defaults to Tokens unit with real stat values", async () => {
    const tokens = await consumption.getStatValue("Total Tokens");
    expect(tokens).not.toBe("");
    expect(parseInt(tokens.replace(/,/g, ""), 10)).toBeGreaterThan(0);
  });

  test("By Source & Model table lists seeded activity", async () => {
    const rows = consumption.getModelRows();
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
  });

  test("switching to USD unit shows the honest empty state", async () => {
    await consumption.selectUnit("USD");
    expect(await consumption.hasUsdEmptyState()).toBeTruthy();
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

    await consumption.selectPreset("All time");
    await expect(page.getByText("Showing: All time")).toBeVisible();
  });
});
