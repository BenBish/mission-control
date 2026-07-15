/**
 * JobsPage — page object for the Jobs view (background_jobs/job_runs).
 * Read-only: list -> detail -> run history. There is no mutation backend
 * (no enable/disable/run-now/delete) — background_jobs are collector-
 * observed facts, not schedulable/controllable cron jobs.
 */

import { type Page, type Locator } from "@playwright/test";
import { BasePage } from "./BasePage.js";

export class JobsPage extends BasePage {
  readonly heading: Locator;
  readonly emptyState: Locator;
  readonly jobsTable: Locator;
  readonly backButton: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.getByRole("heading", { name: "Jobs", level: 1 });
    this.emptyState = page.getByText("No background jobs observed yet.");
    this.jobsTable = page.locator("table");
    this.backButton = page.getByRole("button", { name: /Back to Jobs/i });
  }

  async goto() {
    await super.goto("/jobs");
  }

  async gotoDetail(jobId: string) {
    await super.goto(`/jobs/${jobId}`);
  }

  async waitForContent() {
    await this.page
      .locator("main :text('Jobs'), main :text('No background jobs observed')")
      .first()
      .waitFor({ state: "visible", timeout: 10_000 });
  }

  /** Check if empty state is visible */
  async hasEmptyState(): Promise<boolean> {
    return this.emptyState.isVisible();
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

  /** Click a job row by index, navigating to its detail page */
  async clickRow(index: number) {
    await this.getJobRows().nth(index).click();
  }

  // ── Detail page ────────────────────────────────────────────────────────

  async waitForDetail() {
    await this.backButton.waitFor({ state: "visible", timeout: 10_000 });
  }

  getRunRows(): Locator {
    return this.page.locator("div.rounded-lg.border").filter({
      has: this.page.locator("p.text-sm.font-medium"),
    });
  }
}
