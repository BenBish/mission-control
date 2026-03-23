/**
 * Sessions page E2E tests.
 * Tests list page and session detail (stat cards, top tools, activity feed tab).
 */

import { test, expect } from "../fixtures/base.js";
import { SessionsPage } from "../page-objects/SessionsPage.js";
import { SessionDetailPage } from "../page-objects/SessionDetailPage.js";

test.describe("Sessions List", () => {
  let sessions: SessionsPage;

  test.beforeEach(async ({ page }) => {
    sessions = new SessionsPage(page);
    await sessions.goto();
    await sessions.waitForContent();
  });

  test("renders page heading and session count", async ({ page }) => {
    await expect(sessions.heading).toBeVisible();
    // Should show session count badge
    await expect(page.getByText(/\d+ sessions/)).toBeVisible();
  });

  test("table shows rows for seeded sessions", async () => {
    const count = await sessions.getRowCount();
    expect(count).toBe(5);
  });

  test("session row displays start time, actors, and actions columns", async ({
    page,
  }) => {
    const headers = await sessions.table.locator("thead th").allTextContents();
    expect(headers.map((h) => h.trim())).toEqual(
      expect.arrayContaining(["Started", "Actors", "Actions"]),
    );

    const firstRow = sessions.getRows().first();
    // Started column should have time text
    const startedCell = firstRow.locator("td").nth(0);
    await expect(startedCell).not.toBeEmpty();

    // Actions column (index 3) should have a number
    const actionsCell = firstRow.locator("td").nth(3);
    const actionsText = await actionsCell.textContent();
    expect(actionsText?.trim()).toMatch(/\d+/);
  });

  test("clicking a session row navigates to session detail", async ({
    page,
  }) => {
    await sessions.clickSessionRow(0);
    await page.waitForURL(/\/sessions\/session-e2e-/);
    expect(page.url()).toContain("/sessions/session-e2e-");
  });
});

test.describe("Session Detail", () => {
  let detail: SessionDetailPage;

  test.beforeEach(async ({ page }) => {
    detail = new SessionDetailPage(page);
    await detail.goto("session-e2e-001");
    await detail.waitForDetail();
  });

  test("shows stat cards on overview tab", async ({ page }) => {
    // Overview is the default tab — stat cards in the tabpanel
    const tabpanel = page.getByRole("tabpanel");
    await expect(tabpanel.getByText("Total Actions")).toBeVisible();
    await expect(tabpanel.getByText("Success Rate")).toBeVisible();
    await expect(tabpanel.getByText("Total Cost")).toBeVisible();
  });

  test("overview tab shows Top Tools section", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "Top Tools" }),
    ).toBeVisible();
  });

  test("activity feed tab renders activity rows", async ({ page }) => {
    await detail.clickTab("Activity Feed");
    // Wait for activity feed content
    await expect(page.getByText(/Activity Feed/).first()).toBeVisible();
    // Should show activities or empty state
    const hasActivities = await page
      .locator(".rounded-lg.border.p-3")
      .first()
      .isVisible()
      .catch(() => false);
    const hasEmpty = await page
      .getByText("No activities recorded")
      .isVisible()
      .catch(() => false);
    expect(hasActivities || hasEmpty).toBe(true);
  });
});
