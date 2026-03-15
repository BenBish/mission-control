/**
 * CostBreakdownPage — page object for the Cost Breakdown view.
 */

import { type Page, type Locator } from "@playwright/test";
import { BasePage } from "./BasePage.js";

export class CostBreakdownPage extends BasePage {
  readonly heading: Locator;
  readonly refreshButton: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.getByRole("heading", {
      name: "Cost Breakdown",
      level: 1,
    });
    this.refreshButton = page.getByRole("button", { name: "Refresh" });
  }

  async goto() {
    await super.goto("/costs");
  }

  /** Wait for cost data to load */
  async waitForData() {
    await this.heading.waitFor({ state: "visible" });
    // Wait for the "Total Cost" stat card heading
    await this.page
      .getByRole("heading", { name: "Total Cost", level: 3 })
      .waitFor({ state: "visible" });
  }

  /** Get stat card value by title (e.g. "Total Cost", "Activities") */
  async getStatValue(title: string): Promise<string> {
    const card = this.page
      .getByRole("heading", { name: title, level: 3 })
      .locator("xpath=ancestor::div[contains(@class, 'rounded-lg')]")
      .first();
    const value = card.locator("div.text-3xl");
    return ((await value.textContent()) ?? "").trim();
  }

  /** Get stat card description by title */
  async getStatDescription(title: string): Promise<string> {
    const card = this.page
      .getByRole("heading", { name: title, level: 3 })
      .locator("xpath=ancestor::div[contains(@class, 'rounded-lg')]")
      .first();
    const desc = card.locator("p.text-xs").first();
    return ((await desc.textContent()) ?? "").trim();
  }

  /** Get the Cost by Model table */
  getModelTable(): Locator {
    // Navigate from the heading up to the Card, then find the table within it
    return this.page
      .getByRole("heading", { name: "Cost by Model" })
      .locator("xpath=ancestor::div[contains(@class, 'rounded-lg')]")
      .first()
      .locator("table");
  }

  /** Get model table rows */
  getModelRows(): Locator {
    return this.getModelTable().locator("tbody tr");
  }

  /** Get the Cost by Actor table */
  getActorTable(): Locator {
    return this.page
      .getByRole("heading", { name: "Cost by Actor" })
      .locator("xpath=ancestor::div[contains(@class, 'rounded-lg')]")
      .first()
      .locator("table");
  }

  /** Get actor table rows */
  getActorRows(): Locator {
    return this.getActorTable().locator("tbody tr");
  }

  /** Get the Cost by Tool table */
  getToolTable(): Locator {
    return this.page
      .getByRole("heading", { name: "Cost by Tool" })
      .locator("xpath=ancestor::div[contains(@class, 'rounded-lg')]")
      .first()
      .locator("table");
  }

  /** Get tool table rows */
  getToolRows(): Locator {
    return this.getToolTable().locator("tbody tr");
  }

  /** Click the refresh button */
  async refresh() {
    await this.refreshButton.click();
  }

  /** Check if empty state is visible */
  async hasEmptyState(): Promise<boolean> {
    return this.page.getByText("No cost data available yet.").isVisible();
  }

  /** Check if error state is visible */
  async hasError(): Promise<boolean> {
    return this.page.getByText("Error").isVisible();
  }

  /** Get a date preset button by label */
  getPresetButton(label: string): Locator {
    return this.page.getByRole("button", { name: label, exact: true });
  }

  /** Click a date preset button */
  async selectPreset(label: string) {
    await this.getPresetButton(label).click();
  }

  /** Get the active range label text */
  async getRangeLabel(): Promise<string> {
    return (
      (await this.page.locator("text=Showing:").textContent()) ?? ""
    ).trim();
  }

  /** Check if the custom date inputs are visible */
  async hasCustomDateInputs(): Promise<boolean> {
    const from = this.page.locator("#cost-date-from");
    const to = this.page.locator("#cost-date-to");
    return (await from.isVisible()) && (await to.isVisible());
  }

  /** Fill custom date range */
  async fillCustomRange(from: string, to: string) {
    await this.page.locator("#cost-date-from").fill(from);
    await this.page.locator("#cost-date-to").fill(to);
  }
}
