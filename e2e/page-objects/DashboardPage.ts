/**
 * DashboardPage — page object for the Dashboard view.
 */

import { type Page, type Locator } from "@playwright/test";
import { BasePage } from "./BasePage.js";

export class DashboardPage extends BasePage {
  readonly heading: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.getByRole("heading", { name: "Dashboard", level: 1 });
  }

  async goto() {
    await super.goto("/");
  }

  /** Wait until stat cards are populated (not showing "—") */
  async waitForStats() {
    await this.heading.waitFor({ state: "visible" });
    // Wait for the "Total Activities" stat card heading to appear
    await this.page
      .getByRole("heading", { name: "Total Activities", level: 3 })
      .waitFor({ state: "visible" });
  }

  /** Get all 4 stat card titles */
  async getStatCardTitles(): Promise<string[]> {
    const titles: string[] = [];
    for (const name of [
      "Total Activities",
      "Total Cost",
      "Success Rate",
      "Active Actors",
    ]) {
      const heading = this.page.getByRole("heading", { name, level: 3 });
      if (await heading.isVisible()) {
        titles.push(name);
      }
    }
    return titles;
  }

  /** Get stat card value by title */
  async getStatValue(title: string): Promise<string> {
    // Navigate from the heading up to the Card component (div.rounded-lg)
    const card = this.page
      .getByRole("heading", { name: title, level: 3 })
      .locator("xpath=ancestor::div[contains(@class, 'rounded-lg')]")
      .first();
    const value = card.locator("div.text-3xl");
    return ((await value.textContent()) ?? "").trim();
  }

  /** Get recent activity rows — clickable divs in the Recent Activity card */
  getRecentActivityRows(): Locator {
    const recentCard = this.page.locator("div").filter({
      has: this.page.getByRole("heading", { name: "Recent Activity" }),
    });
    return recentCard.locator("div[class*='cursor-pointer']");
  }

  /** Get "View All" button */
  getViewAllButton(): Locator {
    return this.page.getByRole("button", { name: "View All" });
  }

  /** Get the Activity Volume chart card */
  getActivityVolumeCard(): Locator {
    return this.page.locator("div").filter({
      has: this.page.getByRole("heading", { name: "Activity Volume" }),
    });
  }

  /** Get the Daily Cost chart card */
  getDailyCostCard(): Locator {
    return this.page.locator("div").filter({
      has: this.page.getByRole("heading", { name: "Daily Cost" }),
    });
  }

  /** Wait for chart containers to render (SVGs inside recharts) */
  async waitForCharts() {
    await this.page
      .getByRole("heading", { name: "Activity Volume" })
      .waitFor({ state: "visible" });
    await this.page
      .getByRole("heading", { name: "Daily Cost" })
      .waitFor({ state: "visible" });
  }

  /** Check if the empty state message is visible */
  async hasEmptyRecentActivity(): Promise<boolean> {
    return this.page.getByText("No recent activity found.").isVisible();
  }

  /** Check if error state is visible */
  async hasError(): Promise<boolean> {
    return this.page.getByText("Error loading dashboard").isVisible();
  }
}
