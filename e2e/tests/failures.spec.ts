/**
 * Failure Analysis — summary cards use server aggregates; groups are paginated.
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

function mockGroupsPage(count: number) {
  const now = new Date().toISOString();
  return Array.from({ length: count }, (_, i) => ({
    fingerprint: `activity|claude-code|mock failure ${i}`,
    kind: i % 3 === 0 ? "inference_request" : "activity",
    sourceId: "claude-code",
    summary: `Mock failure ${i}`,
    occurrenceCount: i === 0 ? 12 : 1,
    firstSeen: now,
    lastSeen: now,
    resolved: false,
    openCount: i === 0 ? 12 : 1,
  }));
}

async function mockGroupsApi(
  page: import("@playwright/test").Page,
  body: {
    groups: ReturnType<typeof mockGroupsPage>;
    groupTotal: number;
    summary: typeof MOCK_SUMMARY;
  },
) {
  await page.route("**/api/failures/groups**", async (route) => {
    const url = route.request().url();
    // Drill-down events under a group — return empty page.
    if (url.includes("/events")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          fingerprint: "mock",
          events: [],
          total: 0,
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        ...body,
      }),
    });
  });
}

test.describe("Failure Analysis summary", () => {
  test("empty dataset shows zero total and empty state", async ({ page }) => {
    await mockGroupsApi(page, {
      groups: [],
      groupTotal: 0,
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
    });

    await page.goto("/failures");
    await expect(
      page.getByRole("heading", { name: "Total Failures", level: 3 }),
    ).toBeVisible();
    await expect(page.getByText("No failures found.")).toBeVisible();
  });

  test("multi-page dataset shows aggregate total, not group page length", async ({
    page,
  }) => {
    // Groups page returns 25 rows but summary.total is 87 events / 40 groups.
    await mockGroupsApi(page, {
      groups: mockGroupsPage(25),
      groupTotal: 40,
      summary: MOCK_SUMMARY,
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

    await expect(page.getByText(/Groups 1–25 of 40/i)).toBeVisible();
    // Must not present group page length (25) as the all-time event total
    await expect(totalCard.locator("div.text-3xl")).not.toHaveText("25");
    // Unique groups card shows filtered group count
    const groupsCard = page
      .getByRole("heading", { name: "Unique Groups", level: 3 })
      .locator("xpath=ancestor::div[contains(@class, 'rounded-lg')]")
      .first();
    await expect(groupsCard.locator("div.text-3xl")).toHaveText("40");
  });

  test("partial page: total matches event count under the limit", async ({
    page,
  }) => {
    await mockGroupsApi(page, {
      groups: mockGroupsPage(3),
      groupTotal: 3,
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
    });

    await page.goto("/failures");

    const totalCard = page
      .getByRole("heading", { name: "Total Failures", level: 3 })
      .locator("xpath=ancestor::div[contains(@class, 'rounded-lg')]")
      .first();
    await expect(totalCard.locator("div.text-3xl")).toHaveText("3");
    await expect(page.getByText(/Groups 1–3 of 3/i)).toBeVisible();
  });
});
