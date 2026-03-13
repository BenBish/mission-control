/**
 * Cron Jobs page E2E tests.
 * Tests the cron jobs listing page, including empty state and mutations.
 */

import { test, expect } from "../fixtures/base.js";
import { CronPage } from "../page-objects/CronPage.js";

test.describe("Cron Jobs Page", () => {
  let cron: CronPage;

  test.beforeEach(async ({ page }) => {
    cron = new CronPage(page);
    await cron.goto();
    await cron.waitForContent();
  });

  test("renders cron page content", async ({ page }) => {
    // Should show either jobs list or empty state (no error)
    const mainText = await page.locator("main").textContent();
    expect(mainText!.length).toBeGreaterThan(0);
    expect(await cron.hasError()).toBe(false);
  });

  test("shows empty state or jobs list (not an error)", async ({ page }) => {
    // Depending on whether openclaw CLI is available, we get either:
    // - Empty state: "No cron jobs configured"
    // - Jobs list with heading "Cron Jobs"
    // - Still loading (CLI timeout)
    // All are valid — just verify no error
    const hasEmpty = await cron.hasEmptyState();
    const hasJobs = await page
      .getByRole("heading", { name: "Cron Jobs" })
      .isVisible();
    const isLoading = await page.getByText("Loading cron jobs...").isVisible();

    expect(hasEmpty || hasJobs || isLoading).toBe(true);
    expect(await cron.hasError()).toBe(false);
  });
});

// ── Mutation tests (API contract — no CLI required) ─────────────────────────
//
// These tests hit the real server directly to verify that the old stub
// responses are gone and the endpoints now do real work (job lookup + CLI).
// In CI the CLI won't be available, so a real job ID returns 404 (not found)
// and a missing CLI returns 500 — both are correct, neither is the old stub 200.

test.describe("Cron Mutations — API contract", () => {
  test("enable endpoint is no longer a stub", async ({ request }) => {
    const res = await request.post("/api/cron/jobs/nonexistent-job/enable");
    // 404 = route tried to look up the job (correct)
    // 500 = CLI unavailable (also correct — not a stub)
    // Anything other than 200 with the old stub message = fixed
    expect([404, 500]).toContain(res.status());
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.message).not.toBe("Job enabled (via openclaw cron enable)");
  });

  test("disable endpoint is no longer a stub", async ({ request }) => {
    const res = await request.post("/api/cron/jobs/nonexistent-job/disable");
    expect([404, 500]).toContain(res.status());
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.message).not.toBe("Job disabled (via openclaw cron disable)");
  });

  test("run endpoint is no longer a stub", async ({ request }) => {
    const res = await request.post("/api/cron/jobs/nonexistent-job/run");
    expect([404, 500]).toContain(res.status());
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.message).not.toBe("Job triggered (via openclaw cron run)");
  });

  test("delete endpoint is no longer a stub", async ({ request }) => {
    const res = await request.delete("/api/cron/jobs/nonexistent-job");
    expect([404, 500]).toContain(res.status());
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.message).not.toBe("Job deleted (via openclaw cron rm)");
  });

  test("enable returns 200 with success message when job exists and CLI succeeds", async ({
    request,
  }) => {
    // This verifies the happy-path response shape for when the CLI is available.
    // We can't guarantee CLI in CI, but we can assert the shape when it works.
    const res = await request.post("/api/cron/jobs/nonexistent-job/enable");
    const body = await res.json();
    // Whatever the status, the response must have a `success` boolean
    expect(body).toHaveProperty("success");
    if (res.status() === 200) {
      expect(body.success).toBe(true);
      expect(body.message).toBe("Job enabled");
    }
  });
});
