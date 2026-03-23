/**
 * Settings page E2E tests.
 * Tests tabs, retention inputs, system info, and about section.
 */

import { test, expect } from "../fixtures/base.js";

test.describe("Settings Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");
    await page.locator("main").waitFor({ state: "visible" });
    // Wait for settings to load
    await expect(
      page.getByRole("heading", { name: "Settings" }).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("renders without error", async ({ page }) => {
    await expect(page.getByText("Error loading settings")).not.toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Settings" }).first(),
    ).toBeVisible();
  });

  test("all four tabs are visible", async ({ page }) => {
    await expect(
      page.getByRole("tab", { name: "Data Retention" }),
    ).toBeVisible();
    await expect(page.getByRole("tab", { name: "Profiles" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "System" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "About" })).toBeVisible();
  });

  test("Data Retention tab shows hot/warm days inputs", async ({ page }) => {
    // Data Retention is the default tab
    await expect(page.locator("#hotDays")).toBeVisible();
    await expect(page.locator("#warmDays")).toBeVisible();
  });

  test("System tab shows DB path", async ({ page }) => {
    await page.getByRole("tab", { name: "System" }).click();
    await expect(page.getByText("Database Path")).toBeVisible();
  });

  test("About tab shows a version string", async ({ page }) => {
    await page.getByRole("tab", { name: "About" }).click();
    await expect(page.getByText("Version:")).toBeVisible();
    await expect(page.getByText("0.0.0")).toBeVisible();
  });
});
