/**
 * SkillsPage — page object for the Skills Registry view.
 */

import { type Page, type Locator } from "@playwright/test";
import { BasePage } from "./BasePage.js";

export class SkillsPage extends BasePage {
  readonly heading: Locator;
  readonly searchInput: Locator;
  readonly emptyState: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.getByRole("heading", {
      name: "Skills Registry",
      level: 1,
    });
    this.searchInput = page.getByPlaceholder("Search skills...");
    this.emptyState = page.getByText("No skills found");
  }

  async goto() {
    await super.goto("/skills");
  }

  async waitForContent() {
    await this.heading.waitFor({ state: "visible" });
    // Wait for loading to finish — either skill cards or empty state
    await this.page
      .locator("main")
      .locator("[class*='grid'], :text('No skills found')")
      .first()
      .waitFor({ state: "visible", timeout: 10_000 });
  }

  /** Check if empty state is visible */
  async hasEmptyState(): Promise<boolean> {
    return this.emptyState.isVisible();
  }

  /** Check if error state is visible */
  async hasError(): Promise<boolean> {
    return this.page.getByText("Error loading skills").isVisible();
  }
}
