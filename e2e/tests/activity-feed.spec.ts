/**
 * Activity Feed page E2E tests.
 * Tests table columns, row data, row click navigation, and empty state.
 */

import { test, expect } from "../fixtures/base.js";
import { ActivityFeedPage } from "../page-objects/ActivityFeedPage.js";

test.describe("Activity Feed", () => {
  let feed: ActivityFeedPage;

  test.beforeEach(async ({ page }) => {
    feed = new ActivityFeedPage(page);
    await feed.goto();
    await feed.waitForTable();
  });

  test("displays page heading and activity count", async () => {
    await expect(feed.heading).toBeVisible();
    const count = await feed.getActivityCount();
    expect(count).toBeGreaterThan(0);
  });

  test("table has correct column headers", async () => {
    const headers = await feed.getColumnHeaders();
    expect(headers).toEqual(
      expect.arrayContaining([
        "Time",
        "Actor",
        "Action",
        "Tool",
        "Status",
        "Tokens",
        "Cost",
      ]),
    );
  });

  test("table rows display data in correct columns", async ({ page }) => {
    const rows = feed.getRows();
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(0);
    expect(rowCount).toBeLessThanOrEqual(50);

    const firstRow = rows.first();

    // Time column (index 0)
    const time = firstRow.locator("td").nth(0);
    await expect(time).not.toBeEmpty();

    // Actor column (index 1) — should show display name like "Claude Opus"
    const actor = firstRow.locator("td").nth(1);
    await expect(actor).toContainText(/Claude/i);

    // Action column (index 2) — should have action type text
    const action = firstRow.locator("td").nth(2);
    await expect(action).not.toBeEmpty();

    // Status column (index 4) — should have a status text
    const status = firstRow.locator("td").nth(4);
    const statusText = await status.textContent();
    expect(statusText).toMatch(/success|failure|pending/i);
  });

  test("clicking a row navigates to activity detail", async ({ page }) => {
    await feed.clickRow(0);
    await page.waitForURL(/\/activities\/activity-e2e-/);
    expect(page.url()).toContain("/activities/activity-e2e-");
  });

  test("rows show cost values with dollar sign", async () => {
    const rows = feed.getRows();
    // Cost is column 6
    const costCell = rows.first().locator("td").nth(6);
    const costText = await costCell.textContent();
    // Cost should contain a dollar amount or be a dash
    expect(costText?.trim()).toMatch(/\$[\d.]+|^—$/);
  });

  test("rows show token counts as numbers", async () => {
    const rows = feed.getRows();
    // Tokens is column 5
    const tokenCell = rows.first().locator("td").nth(5);
    const tokenText = await tokenCell.textContent();
    // Should be a number or a dash
    expect(tokenText?.trim()).toMatch(/^[\d,]+|—$/);
  });
});
