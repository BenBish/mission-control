/**
 * BasePage — shared page object with common navigation and utility methods.
 */

import { type Page, type Locator } from "@playwright/test";

export class BasePage {
  readonly page: Page;
  readonly sidebar: Locator;
  readonly mainContent: Locator;
  readonly themeToggle: Locator;

  constructor(page: Page) {
    this.page = page;
    this.sidebar = page.locator("aside, nav").first();
    this.mainContent = page.locator("main");
    this.themeToggle = page.getByRole("button", { name: /theme|dark|light/i });
  }

  async goto(path = "/") {
    await this.page.goto(path);
    await this.waitForPageLoad();
  }

  async waitForPageLoad() {
    // Use domcontentloaded — networkidle hangs due to SSE/polling connections
    await this.page.waitForLoadState("domcontentloaded");
    await this.mainContent.waitFor({ state: "visible" });
  }

  async getPageTitle(): Promise<string> {
    return this.page.title();
  }

  async toggleTheme() {
    await this.themeToggle.click();
  }

  async getCurrentUrl(): Promise<string> {
    return this.page.url();
  }
}
