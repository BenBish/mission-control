/**
 * Source filter scope E2E — selecting a source must appear on compatible
 * list APIs (Dashboard, Consumption, Activities, Sessions, Failures) and
 * must not imply filtering for account-wide provider billing.
 */

import { type Page, type Request } from "@playwright/test";
import { test, expect } from "../fixtures/base.js";

const SOURCE_STORAGE_KEY = "mc-selected-source";

async function selectSource(page: Page, sourceName: string) {
  // Header source filter is a Radix Select (combobox).
  const trigger = page.getByRole("combobox").first();
  await expect(trigger).toBeEnabled();
  await trigger.click();
  await page.getByRole("option", { name: new RegExp(sourceName, "i") }).click();
}

function isApi(req: Request, path: string): boolean {
  try {
    const url = new URL(req.url());
    return (
      req.method() === "GET" &&
      url.pathname === path &&
      url.searchParams.has("sourceId")
    );
  } catch {
    return false;
  }
}

function sourceIdFrom(req: Request): string | null {
  try {
    return new URL(req.url()).searchParams.get("sourceId");
  } catch {
    return null;
  }
}

test.describe("Source filter scope", () => {
  test.beforeEach(async ({ page }) => {
    // Clear persisted selection so each test starts from "all sources".
    await page.addInitScript((key) => {
      localStorage.removeItem(key);
    }, SOURCE_STORAGE_KEY);
  });

  test("Dashboard requests include sourceId after selecting Codex", async ({
    page,
  }) => {
    await page.goto("/");
    await page
      .getByRole("heading", { name: "Dashboard", level: 1 })
      .waitFor({ state: "visible" });

    const activities = page.waitForRequest(
      (r) => isApi(r, "/api/activities") && sourceIdFrom(r) === "codex",
    );
    const failures = page.waitForRequest(
      (r) => isApi(r, "/api/failures") && sourceIdFrom(r) === "codex",
    );
    const consumption = page.waitForRequest(
      (r) => isApi(r, "/api/consumption") && sourceIdFrom(r) === "codex",
    );

    await selectSource(page, "Codex CLI");

    await Promise.all([activities, failures, consumption]);

    await expect(
      page.getByText(/Overview of AI usage for Codex CLI/i),
    ).toBeVisible();
    await expect(
      page.getByText(/input \+ output, for Codex CLI/i),
    ).toBeVisible();
    // Fleet-wide health still disclosed.
    await expect(page.getByText(/All sources \(fleet-wide\)/i)).toBeVisible();
  });

  test("Activity Feed and Sessions request the selected source", async ({
    page,
  }) => {
    await page.goto("/activities");
    await page
      .getByRole("heading", { name: "Activity Feed", level: 1 })
      .waitFor({ state: "visible" });

    const activitiesReq = page.waitForRequest(
      (r) => isApi(r, "/api/activities") && sourceIdFrom(r) === "claude-code",
    );
    await selectSource(page, "Claude Code");
    await activitiesReq;

    const sessionsReq = page.waitForRequest(
      (r) => isApi(r, "/api/sessions") && sourceIdFrom(r) === "claude-code",
    );
    await page.goto("/sessions");
    await page
      .getByRole("heading", { name: "Sessions", level: 1 })
      .waitFor({ state: "visible" });
    // Source is persisted — sessions should request with sourceId on load.
    await sessionsReq;
  });

  test("Failure Analysis scopes failures to selected source", async ({
    page,
  }) => {
    await page.goto("/failures");
    await page
      .getByRole("heading", { name: "Failure Analysis", level: 1 })
      .waitFor({ state: "visible" });

    const failuresReq = page.waitForRequest(
      (r) => isApi(r, "/api/failures") && sourceIdFrom(r) === "codex",
    );
    await selectSource(page, "Codex CLI");
    await failuresReq;

    await expect(
      page.getByText(/Recent failures for Codex CLI/i),
    ).toBeVisible();
  });

  test("Consumption filters agent usage but labels provider billing as account-wide", async ({
    page,
  }) => {
    await page.goto("/consumption");
    await page
      .getByRole("heading", { name: "Consumption", level: 1 })
      .waitFor({ state: "visible" });

    const consumptionReq = page.waitForRequest(
      (r) => isApi(r, "/api/consumption") && sourceIdFrom(r) === "claude-code",
    );
    await selectSource(page, "Claude Code");
    await consumptionReq;

    // Provider section must not look source-filtered.
    await expect(
      page.getByText(/Account-wide · not filtered by source/i),
    ).toBeVisible();
    await expect(page.getByText(/Partial scope/i)).toBeVisible();
  });

  test("Runtime disables the source selector", async ({ page }) => {
    await page.goto("/runtime");
    await page
      .getByRole("heading", { name: "Runtime", level: 1 })
      .waitFor({ state: "visible" });

    const trigger = page.getByRole("combobox").first();
    await expect(trigger).toBeDisabled();
    await expect(page.getByText(/Not filtered/i)).toBeVisible();
    await expect(
      page.getByText(/Fleet-wide inference telemetry/i),
    ).toBeVisible();
  });
});
