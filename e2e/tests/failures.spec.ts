/**
 * Failure Analysis — summary cards use server aggregates, not page length.
 */

import { test, expect } from "../fixtures/base.js";

const MOCK_SUMMARY = {
  total: 87,
  last24Hours: 19,
  openRuntimeEvents: 3,
  byKind: {
    activity: 50,
    inference_request: 20,
    runtime_event: 17,
  },
  definitions: {
    total: "all-time matching failures",
    last24Hours: "matching failures with timestamp >= now-24h",
    openRuntimeEvents:
      "runtime_events with severity != info and ended_at IS NULL",
    statusScope: "activity failure | inference non-success | runtime non-info",
  },
};

function mockFailuresPage(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    kind: i % 3 === 0 ? "inference_request" : "activity",
    id: `mock-fail-${i}`,
    sourceId: "claude-code",
    timestamp: new Date().toISOString(),
    summary: `Mock failure ${i}`,
  }));
}

test.describe("Failure Analysis summary", () => {
  test("empty dataset shows zero total and empty state", async ({ page }) => {
    await page.route("**/api/failures**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          failures: [],
          summary: {
            ...MOCK_SUMMARY,
            total: 0,
            last24Hours: 0,
            openRuntimeEvents: 0,
            byKind: {
              activity: 0,
              inference_request: 0,
              runtime_event: 0,
            },
          },
        }),
      });
    });

    await page.goto("/failures");
    await expect(
      page.getByRole("heading", { name: "Total Failures", level: 3 }),
    ).toBeVisible();
    await expect(page.getByText("No failures found.")).toBeVisible();
  });

  test("multi-page dataset shows aggregate total, not row count", async ({
    page,
  }) => {
    // API returns only 50 rows (page size) but summary.total is 87.
    await page.route("**/api/failures**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          failures: mockFailuresPage(50),
          summary: MOCK_SUMMARY,
        }),
      });
    });

    await page.goto("/failures");

    const totalCard = page
      .getByRole("heading", { name: "Total Failures", level: 3 })
      .locator("xpath=ancestor::div[contains(@class, 'rounded-lg')]")
      .first();
    await expect(totalCard.locator("div.text-3xl")).toHaveText("87");

    const dayCard = page
      .getByRole("heading", { name: "Last 24 Hours", level: 3 })
      .locator("xpath=ancestor::div[contains(@class, 'rounded-lg')]")
      .first();
    await expect(dayCard.locator("div.text-3xl")).toHaveText("19");

    await expect(page.getByText(/Showing 50 of 87 failures/i)).toBeVisible();
    // Must not present page length (50) as the all-time total
    await expect(totalCard.locator("div.text-3xl")).not.toHaveText("50");
  });

  test("partial page: total matches row count under the limit", async ({
    page,
  }) => {
    await page.route("**/api/failures**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          failures: mockFailuresPage(3),
          summary: {
            ...MOCK_SUMMARY,
            total: 3,
            last24Hours: 3,
            openRuntimeEvents: 0,
            byKind: {
              activity: 2,
              inference_request: 1,
              runtime_event: 0,
            },
          },
        }),
      });
    });

    await page.goto("/failures");

    const totalCard = page
      .getByRole("heading", { name: "Total Failures", level: 3 })
      .locator("xpath=ancestor::div[contains(@class, 'rounded-lg')]")
      .first();
    await expect(totalCard.locator("div.text-3xl")).toHaveText("3");
    // Footer only when total > page length
    await expect(page.getByText(/Showing \d+ of \d+ failures/i)).toHaveCount(0);
  });
});
