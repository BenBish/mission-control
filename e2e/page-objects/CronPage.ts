/**
 * CronPage — page object for the Cron Jobs view.
 */

import { type Page, type Locator } from "@playwright/test";
import { BasePage } from "./BasePage.js";

export class CronPage extends BasePage {
  readonly heading: Locator;
  readonly emptyState: Locator;
  readonly jobsTable: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.getByRole("heading", { name: "Cron Jobs" });
    this.emptyState = page.getByText("No cron jobs configured");
    this.jobsTable = page.locator("table");
  }

  async goto() {
    await super.goto("/cron");
  }

  async waitForContent() {
    // Wait for loading to finish — either jobs table/heading or empty state
    await this.page
      .locator(
        "main :text('Cron Jobs'), main :text('No cron jobs configured'), main :text('Error loading cron jobs')",
      )
      .first()
      .waitFor({ state: "visible", timeout: 10_000 });
  }

  /** Check if empty state is visible */
  async hasEmptyState(): Promise<boolean> {
    return this.emptyState.isVisible();
  }

  /** Check if error state is visible */
  async hasError(): Promise<boolean> {
    return this.page.getByText("Error loading cron jobs").isVisible();
  }

  /** Get table column headers */
  async getColumnHeaders(): Promise<string[]> {
    const headers = this.jobsTable.locator("thead th");
    return headers.allTextContents();
  }

  /** Get table rows (body only) */
  getJobRows(): Locator {
    return this.jobsTable.locator("tbody tr");
  }

  // ── Mutation helpers ───────────────────────────────────────────────────────

  /**
   * Mock a cron mutation endpoint to return a controlled response.
   * Call before navigating or triggering the action.
   */
  async mockMutation(
    method: "POST" | "DELETE",
    urlPattern: string | RegExp,
    response: { status: number; body: object },
  ) {
    await this.page.route(urlPattern, (route) => {
      if (route.request().method() === method) {
        route.fulfill({
          status: response.status,
          contentType: "application/json",
          body: JSON.stringify(response.body),
        });
      } else {
        route.continue();
      }
    });
  }

  /** Mock enable endpoint for a job */
  async mockEnable(jobId: string, success = true) {
    await this.mockMutation(
      "POST",
      `**/api/cron/jobs/${jobId}/enable`,
      success
        ? { status: 200, body: { success: true, message: "Job enabled" } }
        : { status: 500, body: { success: false, error: "Failed to enable job" } },
    );
  }

  /** Mock disable endpoint for a job */
  async mockDisable(jobId: string, success = true) {
    await this.mockMutation(
      "POST",
      `**/api/cron/jobs/${jobId}/disable`,
      success
        ? { status: 200, body: { success: true, message: "Job disabled" } }
        : { status: 500, body: { success: false, error: "Failed to disable job" } },
    );
  }

  /** Mock run endpoint for a job */
  async mockRun(jobId: string, success = true) {
    await this.mockMutation(
      "POST",
      `**/api/cron/jobs/${jobId}/run`,
      success
        ? { status: 200, body: { success: true, message: "Job triggered" } }
        : { status: 500, body: { success: false, error: "Failed to trigger job" } },
    );
  }

  /** Mock delete endpoint for a job */
  async mockDelete(jobId: string, success = true) {
    await this.mockMutation(
      "DELETE",
      `**/api/cron/jobs/${jobId}`,
      success
        ? { status: 200, body: { success: true, message: "Job deleted" } }
        : { status: 500, body: { success: false, error: "Failed to delete job" } },
    );
  }

  /**
   * Mock the jobs list endpoint to return a controlled set of jobs.
   * Useful for testing mutation UI without needing the CLI.
   */
  async mockJobsList(jobs: object[]) {
    await this.page.route("**/api/cron/jobs", (route) => {
      if (route.request().method() === "GET") {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true, jobs }),
        });
      } else {
        route.continue();
      }
    });
  }
}
