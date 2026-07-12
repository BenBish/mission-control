/**
 * Jobs page E2E tests.
 * Read-only: list -> detail -> run history. No mutation UI — background_jobs
 * are collector-observed facts (the old Cron page's enable/disable/run-now/
 * delete flows have no backend anymore).
 */

import { test, expect } from "../fixtures/base.js";
import { JobsPage } from "../page-objects/JobsPage.js";

test.describe("Jobs", () => {
  let jobs: JobsPage;

  test.beforeEach(async ({ page }) => {
    jobs = new JobsPage(page);
    await jobs.goto();
    await jobs.waitForContent();
  });

  test("displays page heading", async () => {
    await expect(jobs.heading).toBeVisible();
  });

  test("lists seeded background jobs", async () => {
    const rows = jobs.getJobRows();
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test("table has correct column headers", async () => {
    const headers = await jobs.getColumnHeaders();
    expect(headers).toEqual(
      expect.arrayContaining(["Name", "Source", "Kind", "Last Run", "Status"]),
    );
  });

  test("clicking a job row navigates to its detail page", async ({ page }) => {
    await jobs.clickRow(0);
    await page.waitForURL(/\/jobs\/.+/);
    expect(page.url()).toMatch(/\/jobs\/.+/);
  });

  test("job detail shows status and recent runs", async ({ page }) => {
    await jobs.gotoDetail("collector:claude-code@arch-desktop");
    await jobs.waitForDetail();

    await expect(
      page.getByRole("heading", { name: "Status", level: 3 }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Recent Runs", level: 3 }),
    ).toBeVisible();

    // Seeded two successful runs for this job
    await expect(page.getByText("success").first()).toBeVisible();
  });

  test("back button on detail page returns to Jobs list", async ({ page }) => {
    await jobs.gotoDetail("collector:claude-code@arch-desktop");
    await jobs.waitForDetail();

    await jobs.backButton.click();
    await page.waitForURL("/jobs");
    expect(page.url()).toContain("/jobs");
  });

  test("unknown job id shows an error, not a crash", async ({ page }) => {
    await jobs.gotoDetail("does-not-exist");
    await page.locator("main").waitFor({ state: "visible" });

    await expect(page.getByText(/not found|error/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });
});
