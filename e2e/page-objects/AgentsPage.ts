/**
 * AgentsPage — page object for the Agents listing view.
 */

import { type Page, type Locator } from "@playwright/test";
import { BasePage } from "./BasePage.js";

export class AgentsPage extends BasePage {
  readonly heading: Locator;
  readonly searchInput: Locator;
  readonly emptyState: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.getByRole("heading", { name: "Agents", level: 1 });
    this.searchInput = page.getByPlaceholder("Search agents by name...");
    this.emptyState = page.getByText("No agents found");
  }

  async goto() {
    await super.goto("/agents");
  }

  async waitForContent() {
    await this.heading.waitFor({ state: "visible" });
    // Wait for loading to finish — either agent cards or empty state
    await this.page
      .locator("main")
      .locator("[class*='grid'], :text('No agents found')")
      .first()
      .waitFor({ state: "visible", timeout: 10_000 });
  }

  /** Get all agent card elements */
  getAgentCards(): Locator {
    return this.page.locator("[class*='grid'] > div").filter({
      has: this.page.locator("[class*='cursor-pointer']"),
    });
  }

  /** Check if empty state is visible */
  async hasEmptyState(): Promise<boolean> {
    return this.emptyState.isVisible();
  }

  /** Check if error state is visible */
  async hasError(): Promise<boolean> {
    return this.page.getByText("Error loading agents").isVisible();
  }
}
