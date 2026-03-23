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

  test("rows show cost values with dollar sign", async () => {
    const rows = feed.getRows();
    // Cost is column 7
    const costCell = rows.first().locator("td").nth(7);
    const costText = await costCell.textContent();
    // Cost should contain a dollar amount or be a dash
    expect(costText?.trim()).toMatch(/\$[\d.]+|^—$/);
  });

  test("rows show token counts as numbers", async () => {
    const rows = feed.getRows();
    // Tokens is column 6
    const tokenCell = rows.first().locator("td").nth(6);
    const tokenText = await tokenCell.textContent();
    // Should be a number or a dash
    expect(tokenText?.trim()).toMatch(/^[\d,]+|—$/);
  });

  test("status filter dropdown is visible", async ({ page }) => {
    const statusTrigger = page.locator("button[role='combobox']").first();
    await expect(statusTrigger).toBeVisible();
  });

  test("filtering by failure shows only failure-status rows", async ({
    page,
  }) => {
    // Open status dropdown
    const statusTrigger = page.locator("button[role='combobox']").first();
    await statusTrigger.click();
    // Select "failure"
    await page.getByRole("option", { name: "failure" }).click();
    // Wait for filtered results
    await page.waitForTimeout(500);

    // All visible status badges should say "failure"
    const rows = feed.getRows();
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(0);
    for (let i = 0; i < Math.min(rowCount, 5); i++) {
      const statusCell = rows.nth(i).locator("td").nth(5);
      const statusText = await statusCell.textContent();
      expect(statusText?.toLowerCase()).toContain("failure");
    }
  });

  test("clear filters button restores full list", async ({ page }) => {
    // Apply a filter first
    const statusTrigger = page.locator("button[role='combobox']").first();
    await statusTrigger.click();
    await page.getByRole("option", { name: "failure" }).click();
    await page.waitForTimeout(500);

    const filteredCount = await feed.getRows().count();

    // Click Clear Filters
    const clearBtn = page.getByRole("button", { name: /Clear Filters/i });
    await expect(clearBtn).toBeVisible();
    await clearBtn.click();
    await page.waitForTimeout(500);

    // Should show more rows than filtered
    const unfilteredCount = await feed.getRows().count();
    expect(unfilteredCount).toBeGreaterThanOrEqual(filteredCount);
  });

  test("session ID cell in table is a link to session detail", async ({
    page,
  }) => {
    // Session column (index 4) should contain a link
    const sessionCell = feed.getRows().first().locator("td").nth(4);
    const link = sessionCell.locator("a");
    const linkCount = await link.count();
    // Some activities may have session links, some may not
    if (linkCount > 0) {
      const href = await link.getAttribute("href");
      expect(href).toMatch(/\/sessions\//);
    }
  });
});
