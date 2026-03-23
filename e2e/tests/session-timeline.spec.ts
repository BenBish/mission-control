/**
 * Session Timeline E2E tests.
 * Tests the Timeline tab on the Session Detail page.
 */

import { test, expect } from "../fixtures/base.js";
import { SessionDetailPage } from "../page-objects/SessionDetailPage.js";

test.describe("Session Timeline", () => {
  let detail: SessionDetailPage;

  test.beforeEach(async ({ page }) => {
    detail = new SessionDetailPage(page);
  });

  test("session detail has three tabs including Timeline", async () => {
    await detail.goto("session-e2e-001");
    await detail.waitForDetail();

    const tabs = await detail.getTabNames();
    expect(tabs).toContain("Overview");
    expect(tabs).toContain("Activity Feed");
    expect(tabs).toContain("Timeline");
  });

  test("clicking Timeline tab shows timeline content", async ({ page }) => {
    await detail.goto("session-e2e-001");
    await detail.waitForDetail();

    await detail.clickTab("Timeline");

    // Should show either the swimlane timeline or the simple list fallback
    const hasSwimlanes = await page
      .getByTestId("timeline-swimlanes")
      .isVisible()
      .catch(() => false);
    const hasSimpleList = await page
      .getByText("Activity Timeline")
      .isVisible()
      .catch(() => false);

    expect(hasSwimlanes || hasSimpleList).toBeTruthy();
  });

  test("timeline shows summary bar with duration info", async ({ page }) => {
    await detail.goto("session-e2e-001");
    await detail.waitForDetail();
    await detail.clickTab("Timeline");

    // Wait for timeline content to load
    await page.waitForTimeout(500);

    // Summary bar should show Total Duration (swimlane view) or Activity Timeline (list view)
    const hasTotalDuration = await page
      .getByText("Total Duration")
      .isVisible()
      .catch(() => false);
    const hasActivityTimeline = await page
      .getByText("Activity Timeline")
      .isVisible()
      .catch(() => false);

    expect(hasTotalDuration || hasActivityTimeline).toBeTruthy();
  });

  test("timeline pills/dots are clickable and navigate to activity detail", async ({
    page,
  }) => {
    await detail.goto("session-e2e-001");
    await detail.waitForDetail();
    await detail.clickTab("Timeline");

    // Wait for timeline to render
    await page.waitForTimeout(500);

    // Find any pill or dot or list item button
    const pill = page.locator("[data-testid^='timeline-pill-']").first();
    const dot = page.locator("[data-testid^='timeline-dot-']").first();
    const listButton = page
      .locator("button")
      .filter({ hasText: "E2E test activity" })
      .first();

    const hasPill = await pill.isVisible().catch(() => false);
    const hasDot = await dot.isVisible().catch(() => false);
    const hasListButton = await listButton.isVisible().catch(() => false);

    if (hasPill) {
      await pill.click();
      await page.waitForURL(/\/activities\//);
      expect(page.url()).toContain("/activities/");
    } else if (hasDot) {
      await dot.click();
      await page.waitForURL(/\/activities\//);
      expect(page.url()).toContain("/activities/");
    } else if (hasListButton) {
      await listButton.click();
      await page.waitForURL(/\/activities\//);
      expect(page.url()).toContain("/activities/");
    } else {
      // No activities for this session — this is acceptable
      const noActivities = await page
        .getByText("No activities recorded")
        .isVisible()
        .catch(() => false);
      expect(noActivities).toBeTruthy();
    }
  });
});
