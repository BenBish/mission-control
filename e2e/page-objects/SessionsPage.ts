/**
 * SessionsPage — page object for the Sessions list view.
 */

import { type Page, type Locator } from "@playwright/test";
import { BasePage } from "./BasePage.js";

export class SessionsPage extends BasePage {
  readonly heading: Locator;
  readonly table: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.getByRole("heading", { name: "Sessions", level: 1 });
    this.table = page.locator("table");
  }

  async goto() {
    await super.goto("/sessions");
  }

  /** Wait for heading and table (or empty state) to appear */
  async waitForContent() {
    await this.heading.waitFor({ state: "visible" });
    await this.page
      .locator("table, :text('No sessions recorded yet')")
      .first()
      .waitFor({ state: "visible", timeout: 15_000 });
  }

  /** Get all table body rows */
  getRows(): Locator {
    return this.table.locator("tbody tr");
  }

  /** Get row count */
  async getRowCount(): Promise<number> {
    return this.getRows().count();
  }

  /** Click a session row by index — navigates to /sessions/:id */
  async clickSessionRow(index: number) {
    await this.getRows().nth(index).click();
  }
}
