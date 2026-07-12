/**
 * Activity Detail page E2E tests.
 * Tests all sections, back button, and 404 handling.
 */

import { test, expect } from "../fixtures/base.js";
import { ActivityDetailPage } from "../page-objects/ActivityDetailPage.js";

test.describe("Activity Detail", () => {
  let detail: ActivityDetailPage;

  test.beforeEach(async ({ page }) => {
    detail = new ActivityDetailPage(page);
  });

  test("displays activity detail for a known activity", async () => {
    await detail.goto("activity-e2e-030");
    await detail.waitForDetail();

    // Description should contain our seeded text
    const description = await detail.getDescription();
    expect(description).toContain("E2E test activity 30");

    // Activity ID should be displayed
    const id = await detail.getActivityId();
    expect(id).toBe("activity-e2e-030");
  });

  test("shows status badge", async () => {
    await detail.goto("activity-e2e-030");
    await detail.waitForDetail();

    const status = await detail.getStatus();
    expect(status).toMatch(/success|failure|pending|partial/);
  });

  test("shows Actor card with agent info", async ({ page }) => {
    await detail.goto("activity-e2e-030");
    await detail.waitForDetail();

    expect(await detail.hasActorCard()).toBeTruthy();

    // Actor card should show Type field
    const actorCard = page
      .getByRole("heading", { name: "Actor", level: 3 })
      .locator("xpath=ancestor::div[contains(@class, 'rounded-lg')]")
      .first();
    await expect(actorCard.getByText("Type").first()).toBeVisible();
  });

  test("shows Action card", async ({ page }) => {
    await detail.goto("activity-e2e-030");
    await detail.waitForDetail();

    expect(await detail.hasActionCard()).toBeTruthy();

    // Action card should show Type field
    const actionCard = page
      .getByRole("heading", { name: "Action", level: 3 })
      .locator("xpath=ancestor::div[contains(@class, 'rounded-lg')]")
      .first();
    await expect(actionCard.getByText("Type").first()).toBeVisible();
  });

  test("shows Timing card with started timestamp", async ({ page }) => {
    await detail.goto("activity-e2e-030");
    await detail.waitForDetail();

    expect(await detail.hasTimingCard()).toBeTruthy();

    // Timing card should show Started field
    const timingCard = page
      .getByRole("heading", { name: "Timing", level: 3 })
      .locator("xpath=ancestor::div[contains(@class, 'rounded-lg')]")
      .first();
    await expect(timingCard.getByText("Started")).toBeVisible();
  });

  test("shows Session card with session ID", async () => {
    await detail.goto("activity-e2e-030");
    await detail.waitForDetail();

    expect(await detail.hasSessionCard()).toBeTruthy();

    const sessionId = await detail.getSessionId();
    // Session ids are source-prefixed: 'claude-code:session-e2e-cc-001' etc.
    expect(sessionId).toMatch(/^(claude-code|codex):session-e2e-/);
  });

  test("back button navigates to activity feed", async ({ page }) => {
    await detail.goto("activity-e2e-030");
    await detail.waitForDetail();

    await detail.goBack();
    await page.waitForURL("/activities");
    expect(page.url()).toContain("/activities");
  });

  test("shows error for non-existent activity", async ({ page }) => {
    await detail.goto("non-existent-id-12345");

    // Wait for the error/not-found state
    await page
      .getByText(/not found|error/i)
      .first()
      .waitFor({ state: "visible", timeout: 10000 });

    const hasError = await detail.hasError();
    const hasNotFound = await detail.hasNotFound();
    expect(hasError || hasNotFound).toBeTruthy();
  });
});
