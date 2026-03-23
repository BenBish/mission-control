/**
 * FailuresPage — page object for the Failure Analysis view.
 */

import { type Page, type Locator } from "@playwright/test";
import { BasePage } from "./BasePage.js";

export class FailuresPage extends BasePage {
  readonly heading: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.getByRole("heading", {
      name: "Failure Analysis",
      level: 1,
    });
  }

  async goto() {
    await super.goto("/failures");
  }

  /** Wait for heading and stat cards to load */
  async waitForContent() {
    await this.heading.waitFor({ state: "visible" });
    // Wait for either stat cards or empty state
    await this.page
      .locator(":text('Total Failures'), :text('No failures found')")
      .first()
      .waitFor({ state: "visible", timeout: 15_000 });
  }

  /** Get headline stat cards */
  getStatCards(): Locator {
    return this.page.locator(
      ".grid.gap-4 > div:has(.text-sm.font-medium.text-muted-foreground)",
    );
  }

  /** Get Top Failing Tools table rows */
  getTopFailingToolsRows(): Locator {
    return this.page
      .locator("div:has(> div:has-text('Top Failing Tools'))")
      .locator("tbody tr");
  }

  /** Get Top Failing Actors table rows */
  getTopFailingActorsRows(): Locator {
    return this.page
      .locator("div:has(> div:has-text('Top Failing Actors'))")
      .locator("tbody tr");
  }

  /** Get Recent Failures table rows */
  getRecentFailuresRows(): Locator {
    return this.page
      .locator("div:has(> div:has-text('Recent Failures'))")
      .locator("tbody tr");
  }

  /** Get date range preset buttons */
  getPresetButtons(): Locator {
    return this.page.locator(".flex.gap-2 > button");
  }
}
