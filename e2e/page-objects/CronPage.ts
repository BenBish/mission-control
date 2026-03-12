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
}
