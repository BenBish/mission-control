/**
 * ActivityFeedPage — page object for the Activity Feed view.
 */

import { type Page, type Locator } from "@playwright/test";
import { BasePage } from "./BasePage.js";

export class ActivityFeedPage extends BasePage {
  readonly heading: Locator;
  readonly table: Locator;
  readonly activityCountBadge: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.getByRole("heading", {
      name: "Activity Feed",
      level: 1,
    });
    this.table = page.locator("table");
    this.activityCountBadge = page.getByText(/\d+ activities found/);
  }

  async goto() {
    await super.goto("/activities");
  }

  /** Wait for the table to be populated */
  async waitForTable() {
    await this.heading.waitFor({ state: "visible" });
    await this.table.waitFor({ state: "visible" });
  }

  /** Get all table header texts */
  async getColumnHeaders(): Promise<string[]> {
    const headers = this.table.locator("thead th");
    const texts = await headers.allTextContents();
    return texts.map((t) => t.trim()).filter(Boolean);
  }

  /** Get all table body rows */
  getRows(): Locator {
    return this.table.locator("tbody tr");
  }

  /** Get the count from the "N activities found" badge */
  async getActivityCount(): Promise<number> {
    const text = (await this.activityCountBadge.textContent()) ?? "";
    const match = text.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  /** Click on a specific row by index */
  async clickRow(index: number) {
    await this.getRows().nth(index).click();
  }

  /** Get text content of a specific cell */
  async getCellText(rowIndex: number, colIndex: number): Promise<string> {
    const cell = this.getRows().nth(rowIndex).locator("td").nth(colIndex);
    return ((await cell.textContent()) ?? "").trim();
  }

  /** Check if empty state is visible */
  async hasEmptyState(): Promise<boolean> {
    return this.page.getByText("No activities found").isVisible();
  }

  /** Check if error state is visible */
  async hasError(): Promise<boolean> {
    return this.page.getByText("Error loading activities").isVisible();
  }
}
