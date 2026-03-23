/**
 * Agent Detail page E2E tests.
 * Tests SOUL.md tab, Configuration tab, and workspace file browser.
 */

import { test, expect } from "../fixtures/base.js";

const AGENT_ID = "claude-opus";

test.describe("Agent Detail — Tabs", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/agents/${AGENT_ID}`);
    await page.waitForLoadState("domcontentloaded");
    await page.locator("main").waitFor({ state: "visible" });
    // Wait for agent data to load (agent name heading)
    await expect(
      page.getByRole("heading", { name: AGENT_ID }).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("SOUL.md tab is enabled and shows rendered markdown", async ({
    page,
  }) => {
    const soulTab = page.getByRole("tab", { name: "SOUL.md" });
    await expect(soulTab).toBeVisible();
    await expect(soulTab).toBeEnabled();

    await soulTab.click();
    // Should render SOUL.md content
    await expect(page.getByText("SOUL.md").first()).toBeVisible();
    await expect(
      page.getByText(/AI Software Engineer|software engineering/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("Configuration tab is enabled and shows config summary", async ({
    page,
  }) => {
    const configTab = page.getByRole("tab", { name: "Config" });
    await expect(configTab).toBeVisible();
    await expect(configTab).toBeEnabled();

    await configTab.click();
    // Should show configuration summary card
    await expect(page.getByText("Configuration Summary").first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("Configuration tab shows workspace files", async ({ page }) => {
    const configTab = page.getByRole("tab", { name: "Config" });
    await configTab.click();

    // File tree should render with at least SOUL.md
    await expect(page.getByText("Workspace Files")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("SOUL.md").first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("Overview tab shows git identity as combined badge", async ({
    page,
  }) => {
    const overviewTab = page.getByRole("tab", { name: "Overview" });
    await overviewTab.click();

    // Should show "Git Identity" heading (not separate Author/Email lines)
    await expect(page.getByText("Git Identity")).toBeVisible({
      timeout: 10_000,
    });

    // Should show combined Name <email> badge in the Git Identity section
    // The badge is a direct sibling of the h3 heading
    const gitSection = page
      .locator("h3", { hasText: "Git Identity" })
      .locator("..");
    const badge = gitSection.locator("div.inline-flex");
    await expect(badge).toBeVisible({ timeout: 10_000 });
    const badgeText = await badge.textContent();
    // Verify it matches the "name <email>" pattern
    expect(badgeText).toMatch(/.+<.+@.+>/);
  });

  test("Configuration tab shows git identity as combined badge", async ({
    page,
  }) => {
    const configTab = page.getByRole("tab", { name: "Config" });
    await configTab.click();

    // Should show "Git Identity" label (not separate "Git Author"/"Git Email")
    await expect(page.getByText("Git Identity").first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("Git Author")).not.toBeVisible();
    await expect(page.getByText("Git Email")).not.toBeVisible();
  });

  test("clicking a file in tree loads content in viewer", async ({ page }) => {
    const configTab = page.getByRole("tab", { name: "Config" });
    await configTab.click();

    // Wait for files to load
    await expect(page.getByText("Workspace Files")).toBeVisible({
      timeout: 10_000,
    });

    // Click on SOUL.md in the file tree
    const soulFileButton = page
      .locator("button")
      .filter({ hasText: "SOUL.md" })
      .first();
    await expect(soulFileButton).toBeVisible({ timeout: 10_000 });
    await soulFileButton.click();

    // The viewer should show the file content
    await expect(
      page.getByText(/AI Software Engineer|software engineering/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});
