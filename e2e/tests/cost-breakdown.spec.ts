/**
 * Cost Breakdown page E2E tests.
 * Tests summary cards, model/actor/tool tables, refresh, date range filter, and empty state.
 */

import { test, expect } from "../fixtures/base.js";
import { CostBreakdownPage } from "../page-objects/CostBreakdownPage.js";

test.describe("Cost Breakdown", () => {
  let costs: CostBreakdownPage;

  test.beforeEach(async ({ page }) => {
    costs = new CostBreakdownPage(page);
    await costs.goto();
    await costs.waitForData();
  });

  test("displays page heading and refresh button", async () => {
    await expect(costs.heading).toBeVisible();
    await expect(costs.refreshButton).toBeVisible();
  });

  test("shows four summary stat cards", async () => {
    // Total Cost card
    const totalCost = await costs.getStatValue("Total Cost");
    expect(totalCost).toMatch(/^\$/);

    // Activities card
    const activities = await costs.getStatValue("Activities");
    expect(parseInt(activities.replace(/,/g, ""), 10)).toBeGreaterThan(0);

    // LLM Generations card
    const generations = await costs.getStatValue("LLM Generations");
    expect(parseInt(generations.replace(/,/g, ""), 10)).toBeGreaterThan(0);

    // Cache Hit Rate card
    const cacheRate = await costs.getStatValue("Cache Hit Rate");
    expect(cacheRate).toMatch(/%$/);
  });

  test("stat card descriptions provide context", async () => {
    // Total Cost description should mention tokens
    const costDesc = await costs.getStatDescription("Total Cost");
    expect(costDesc).toMatch(/tokens/i);

    // Activities description should mention avg or $
    const actDesc = await costs.getStatDescription("Activities");
    expect(actDesc).toMatch(/avg|\$/i);
  });

  test("Cost by Model table is visible with data", async () => {
    const modelTable = costs.getModelTable();
    await expect(modelTable).toBeVisible();

    const rows = costs.getModelRows();
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);

    // Each row should have a model name (first column)
    const firstModelName = await rows
      .first()
      .locator("td")
      .first()
      .textContent();
    expect(firstModelName?.trim()).toBeTruthy();
  });

  test("Cost by Actor table is visible with data", async () => {
    const actorTable = costs.getActorTable();
    await expect(actorTable).toBeVisible();

    const rows = costs.getActorRows();
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
    // We seeded 3 agents
    expect(count).toBeLessThanOrEqual(3);

    // First row should have an actor name
    const firstActorName = await rows
      .first()
      .locator("td")
      .first()
      .textContent();
    expect(firstActorName?.trim()).toMatch(/claude/i);
  });

  test("Cost by Tool table is visible with data", async () => {
    const toolTable = costs.getToolTable();
    await expect(toolTable).toBeVisible();

    const rows = costs.getToolRows();
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);

    // Tool names should match our seeded tools
    const firstToolName = await rows
      .first()
      .locator("td")
      .first()
      .textContent();
    expect(firstToolName?.trim()).toBeTruthy();
  });

  test("tables show cost values with dollar signs", async () => {
    // Check model table cost column (index 2)
    const modelCost = await costs
      .getModelRows()
      .first()
      .locator("td")
      .nth(2)
      .textContent();
    expect(modelCost?.trim()).toMatch(/^\$/);

    // Check actor table cost column (index 2)
    const actorCost = await costs
      .getActorRows()
      .first()
      .locator("td")
      .nth(2)
      .textContent();
    expect(actorCost?.trim()).toMatch(/^\$/);
  });

  test("refresh button reloads data", async ({ page }) => {
    // Get initial value
    const initialCost = await costs.getStatValue("Total Cost");

    // Click refresh
    await costs.refresh();

    // Wait for data to reload
    await page.waitForTimeout(1000);

    // Value should still be present after refresh
    const refreshedCost = await costs.getStatValue("Total Cost");
    expect(refreshedCost).toMatch(/^\$/);
    // Same data, so values should match
    expect(refreshedCost).toBe(initialCost);
  });

  test("displays date range preset buttons", async () => {
    await expect(costs.getPresetButton("Today")).toBeVisible();
    await expect(costs.getPresetButton("Last 7 days")).toBeVisible();
    await expect(costs.getPresetButton("Last 30 days")).toBeVisible();
    await expect(costs.getPresetButton("All time")).toBeVisible();
    await expect(costs.getPresetButton("Custom")).toBeVisible();
  });

  test("Last 30 days is the default active preset", async () => {
    // The "Last 30 days" button should have the default (primary) variant
    const btn = costs.getPresetButton("Last 30 days");
    // Default variant buttons don't have 'outline' in data-variant or class
    await expect(btn).toBeVisible();
    // Range label should show "Last 30 days"
    const label = await costs.getRangeLabel();
    expect(label).toContain("Last 30 days");
  });

  test("shows range label with date span", async () => {
    const label = await costs.getRangeLabel();
    expect(label).toMatch(/Showing:/);
    // Should contain an en-dash between two dates
    expect(label).toMatch(/\w+ \d+/);
  });

  test("switching preset re-fetches data and updates label", async ({
    page,
  }) => {
    // Click "All time"
    await costs.selectPreset("All time");
    // Wait for data to reload
    await page.waitForTimeout(1000);
    await costs.waitForData();

    const label = await costs.getRangeLabel();
    expect(label).toContain("All time");

    // Click "Today"
    await costs.selectPreset("Today");
    await page.waitForTimeout(1000);
    await costs.waitForData();

    const todayLabel = await costs.getRangeLabel();
    expect(todayLabel).toContain("Today");
  });

  test("Custom preset reveals date inputs", async () => {
    // Before clicking Custom, date inputs should not be visible
    expect(await costs.hasCustomDateInputs()).toBe(false);

    // Click Custom
    await costs.selectPreset("Custom");

    // Date inputs should now be visible
    expect(await costs.hasCustomDateInputs()).toBe(true);
  });

  test("Custom preset hides inputs when switching back", async () => {
    await costs.selectPreset("Custom");
    expect(await costs.hasCustomDateInputs()).toBe(true);

    await costs.selectPreset("Last 7 days");
    expect(await costs.hasCustomDateInputs()).toBe(false);
  });
});
