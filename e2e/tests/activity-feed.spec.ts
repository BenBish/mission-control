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
        "Session",
        "Status",
        "Tokens",
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

    // Actor column (index 1) — shows actor.id ('user' or 'assistant' for
    // seeded data) and actor.type on the line below
    const actor = firstRow.locator("td").nth(1);
    await expect(actor).toContainText(/user|assistant/i);

    // Action column (index 2) — should have action type text
    const action = firstRow.locator("td").nth(2);
    await expect(action).not.toBeEmpty();

    // Status column (index 5) — should have a status text
    const status = firstRow.locator("td").nth(5);
    const statusText = await status.textContent();
    expect(statusText).toMatch(/success|failure|pending/i);
  });

  test("clicking a row navigates to activity detail", async ({ page }) => {
    // Click on the Time cell (index 0) to avoid hitting the Session link
    await feed.getRows().first().locator("td").nth(0).click();
    await page.waitForURL(/\/activities\/activity-e2e-/);
    expect(page.url()).toContain("/activities/activity-e2e-");
  });

  test("rows show token counts as numbers", async () => {
    const rows = feed.getRows();
    // Tokens is column 6
    const tokenCell = rows.first().locator("td").nth(6);
    const tokenText = await tokenCell.textContent();
    // Should be a number or a dash
    expect(tokenText?.trim()).toMatch(/^[\d,]+|—$/);
  });
});
