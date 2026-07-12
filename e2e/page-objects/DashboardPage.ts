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

  /** Wait until stat cards are populated */
  async waitForStats() {
    await this.heading.waitFor({ state: "visible" });
    // Wait for the "Tokens Today" stat card heading to appear
    await this.page
      .getByRole("heading", { name: "Tokens Today", level: 3 })
      .waitFor({ state: "visible" });
  }

  /**
   * Get all 3 stat card titles. Note: "Recent Failures" is ambiguous by
   * name+level alone — it's also the title of the full failures-list card
   * further down the page (only rendered when there are failures) — so
   * every lookup here takes the first match, which is always the stats
   * grid at the top of the page in DOM order.
   */
  async getStatCardTitles(): Promise<string[]> {
    const titles: string[] = [];
    for (const name of ["Tokens Today", "Recent Failures", "Source Health"]) {
      const heading = this.page
        .getByRole("heading", { name, level: 3 })
        .first();
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
      .first()
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

  /** Get the Token Usage chart card */
  getTokenUsageCard(): Locator {
    return this.page.locator("div").filter({
      has: this.page.getByRole("heading", { name: "Token Usage" }),
    });
  }

  /** Wait for the chart container to render (SVG inside recharts) */
  async waitForCharts() {
    await this.page
      .getByRole("heading", { name: "Token Usage" })
      .waitFor({ state: "visible" });
  }

  /** Get the Source Health badges (one per source, colored status dot) */
  getSourceHealthBadges(): Locator {
    const card = this.page.locator("div").filter({
      has: this.page.getByRole("heading", { name: "Source Health" }),
    });
    return card.locator("span").filter({ hasText: /.+/ });
  }

  /** Check if the empty state message is visible */
  async hasEmptyRecentActivity(): Promise<boolean> {
    return this.page.getByText("No recent activity found.").isVisible();
  }
}
