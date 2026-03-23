/**
 * Failures page E2E tests.
 * Tests heading, stat cards, tables, navigation, and date presets.
 */

import { test, expect } from "../fixtures/base.js";
import { FailuresPage } from "../page-objects/FailuresPage.js";

test.describe("Failure Analysis", () => {
  let failures: FailuresPage;

  test.beforeEach(async ({ page }) => {
    failures = new FailuresPage(page);
    await failures.goto();
    await failures.waitForContent();
  });

  test("renders page heading", async () => {
    await expect(failures.heading).toBeVisible();
  });

  test("headline stat cards are visible", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "Total Failures" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Failure Rate" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Most Failing Tool" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Most Failing Actor" }),
    ).toBeVisible();
  });

  test("top failing tools table has at least one row", async ({ page }) => {
    const toolsHeading = page.getByRole("heading", {
      name: "Top Failing Tools",
    });
    // Navigate up to the card container then find table rows
    const toolsSection = toolsHeading.locator("xpath=ancestor::div[.//table]");
    const toolRows = toolsSection.locator("tbody tr");
    expect(await toolRows.count()).toBeGreaterThan(0);
  });

  test("top failing actors table has at least one row", async ({ page }) => {
    const actorsHeading = page.getByRole("heading", {
      name: "Top Failing Actors",
    });
    const actorsSection = actorsHeading.locator(
      "xpath=ancestor::div[.//table]",
    );
    const actorRows = actorsSection.locator("tbody tr");
    expect(await actorRows.count()).toBeGreaterThan(0);
  });

  test("recent failures table has rows", async ({ page }) => {
    const recentHeading = page.getByRole("heading", {
      name: "Recent Failures",
    });
    const recentSection = recentHeading.locator(
      "xpath=ancestor::div[.//table]",
    );
    const recentRows = recentSection.locator("tbody tr");
    expect(await recentRows.count()).toBeGreaterThan(0);
  });

  test("clicking a recent failure row navigates to activity detail", async ({
    page,
  }) => {
    // Recent Failures rows have cursor-pointer and contain "failure" badge
    // Find the table that follows the "Recent Failures" heading
    const recentTable = page
      .locator("table")
      .filter({ has: page.locator("th", { hasText: "Description" }) });
    const firstRow = recentTable.locator("tbody tr").first();
    await firstRow.click();
    await page.waitForURL(/\/activities\//, { timeout: 10_000 });
    expect(page.url()).toContain("/activities/");
  });

  test("date range preset buttons are visible", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Today" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Last 7 days" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Last 30 days" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "All time" })).toBeVisible();
  });
});
