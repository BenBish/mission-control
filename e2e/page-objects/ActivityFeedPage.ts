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
    // Target the count badge specifically (inside CardDescription, not the pagination span)
    this.activityCountBadge = page
      .locator("div[class*='card'] span, div[class*='card'] div")
      .getByText(/\d+ activities/)
      .first();
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

  /** Get the count from the activity count badge ("N activities" or "Showing X–Y of N") */
  async getActivityCount(): Promise<number> {
    const text = (await this.activityCountBadge.textContent()) ?? "";
    // Match "Showing X–Y of N" format first, extracting total N
    const showingMatch = text.match(/of\s+(\d+)/);
    if (showingMatch) return parseInt(showingMatch[1], 10);
    // Fall back to "N activities" format
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
