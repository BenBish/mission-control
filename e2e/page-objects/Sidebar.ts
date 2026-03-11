/**
 * Sidebar page object — navigation links and mobile menu.
 */

import { type Page, type Locator } from "@playwright/test";

export class Sidebar {
  readonly page: Page;
  readonly nav: Locator;
  readonly mobileMenuButton: Locator;

  constructor(page: Page) {
    this.page = page;
    // The sidebar is inside the aside element (desktop)
    this.nav = page.locator("aside");
    this.mobileMenuButton = page.getByRole("button", {
      name: /menu|toggle/i,
    });
  }

  /** Get a nav link by its visible text */
  getNavLink(label: string): Locator {
    return this.nav.getByRole("link", { name: label });
  }

  /** Click a sidebar nav link */
  async navigateTo(label: string) {
    const link = this.getNavLink(label);
    await link.click();
    await this.page.waitForLoadState("domcontentloaded");
    await this.page.locator("main").waitFor({ state: "visible" });
  }

  /** Get all visible nav links */
  async getVisibleNavLinks(): Promise<string[]> {
    const links = this.nav.getByRole("link");
    return links.allTextContents();
  }

  /** Open mobile sidebar menu (for responsive tests) */
  async openMobileMenu() {
    await this.mobileMenuButton.click();
  }
}
