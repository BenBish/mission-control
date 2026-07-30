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
   * Get stat card titles. "Failures (24h)" is the aggregate summary card
   * (not the optional recent-list card further down the page).
   */
  async getStatCardTitles(): Promise<string[]> {
    const titles: string[] = [];
    for (const name of [
      "Tokens Today",
      "API Spend (30d)",
      "Failures (24h)",
      "Source Health",
    ]) {
      const heading = this.page
        .getByRole("heading", { name, level: 3 })
        .first();
      if (await heading.isVisible()) {
        titles.push(name);
      }
    }
    return titles;
  }

  /** Click the API Spend card (navigates to Direct API Spend on Consumption) */
  async clickApiSpendCard() {
    await this.page
      .getByRole("link", { name: /API Spend last 30 days/i })
      .click();
  }

  /** Get stat card value by title */
  async getStatValue(title: string): Promise<string> {
    const card = this.cardRootForHeading(title);
    const value = card.locator("div.text-3xl");
    return ((await value.textContent()) ?? "").trim();
  }

  /**
   * Card root for a section h3 (matches Card's rounded-lg shell).
   * Prefer this over broad `div.filter({ has: heading })` which matches every ancestor.
   */
  private cardRootForHeading(name: string): Locator {
    return this.page
      .getByRole("heading", { name, level: 3 })
      .locator("xpath=ancestor::div[contains(@class, 'rounded-lg')]")
      .first();
  }

  /** Get the Recent Activity card root */
  getRecentActivityCard(): Locator {
    return this.cardRootForHeading("Recent Activity");
  }

  /** Get recent activity rows — clickable divs in the Recent Activity card */
  getRecentActivityRows(): Locator {
    return this.getRecentActivityCard().locator("div[class*='cursor-pointer']");
  }

  /** Get "View All" button */
  getViewAllButton(): Locator {
    return this.page.getByRole("button", { name: "View All" });
  }

  /** Get the Token Usage chart card root */
  getTokenUsageCard(): Locator {
    return this.cardRootForHeading("Token Usage");
  }

  /** Wait for the chart container to render (SVG inside recharts) */
  async waitForCharts() {
    await this.page
      .getByRole("heading", { name: "Token Usage" })
      .waitFor({ state: "visible" });
  }

  /**
   * Document + Token Usage layout widths for overflow regressions (BSH-67).
   * Uses the Token Usage card root (via section heading) and its chart SVG.
   */
  async getOverflowLayoutMetrics(): Promise<{
    scrollWidth: number;
    clientWidth: number;
    innerWidth: number;
    chartWidth: number;
    cardWidth: number;
    hasChart: boolean;
  }> {
    const card = this.getTokenUsageCard();
    // Recharts may mount SVG slightly after the heading is visible.
    await card
      .locator("svg, .recharts-responsive-container")
      .first()
      .waitFor({ state: "attached", timeout: 10_000 });

    return this.page.evaluate(() => {
      const docEl = document.documentElement;
      const body = document.body;
      const tokenHeading = Array.from(document.querySelectorAll("h3")).find(
        (h) => h.textContent?.trim() === "Token Usage",
      );
      let tokenCard: HTMLElement | null = null;
      let el = tokenHeading?.parentElement ?? null;
      while (el) {
        if (
          el.classList.contains("rounded-lg") &&
          el.classList.contains("border")
        ) {
          tokenCard = el;
          break;
        }
        el = el.parentElement;
      }
      const chartSvg = tokenCard?.querySelector("svg") ?? null;
      return {
        scrollWidth: Math.max(docEl.scrollWidth, body?.scrollWidth ?? 0),
        clientWidth: docEl.clientWidth,
        innerWidth: window.innerWidth,
        chartWidth: chartSvg ? chartSvg.getBoundingClientRect().width : 0,
        cardWidth: tokenCard ? tokenCard.getBoundingClientRect().width : 0,
        hasChart: !!chartSvg,
      };
    });
  }

  /** Get the Source Health badges (one per source, colored status dot) */
  getSourceHealthBadges(): Locator {
    // Badge is a rounded-full div; inner status dots are empty spans.
    return this.cardRootForHeading("Source Health")
      .locator("[class*='rounded-full']")
      .filter({ hasText: /\S/ });
  }

  /** Check if the empty state message is visible */
  async hasEmptyRecentActivity(): Promise<boolean> {
    return this.page.getByText("No recent activity found.").isVisible();
  }
}
