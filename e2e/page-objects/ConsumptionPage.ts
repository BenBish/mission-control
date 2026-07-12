/**
 * ConsumptionPage — page object for the Consumption view (src/pages/Consumption.tsx).
 * Replaces the old CostBreakdown page — has a unit switcher (Tokens/Compute/USD)
 * and an honest empty state on the USD tab when no source has cost_usd populated.
 */

import { type Page, type Locator } from "@playwright/test";
import { BasePage } from "./BasePage.js";

export class ConsumptionPage extends BasePage {
  readonly heading: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.getByRole("heading", {
      name: "Consumption",
      level: 1,
    });
  }

  async goto() {
    await super.goto("/consumption");
  }

  /** Wait for consumption data to load */
  async waitForData() {
    await this.heading.waitFor({ state: "visible" });
  }

  /** Get a date preset button by label ("Today" | "Last 7 days" | "Last 30 days" | "All time") */
  getPresetButton(label: string): Locator {
    return this.page.getByRole("button", { name: label, exact: true });
  }

  async selectPreset(label: string) {
    await this.getPresetButton(label).click();
  }

  /** Get a unit switcher button ("Tokens" | "Compute time" | "USD") */
  getUnitButton(label: string): Locator {
    return this.page.getByRole("button", { name: label, exact: true });
  }

  async selectUnit(label: "Tokens" | "Compute time" | "USD") {
    await this.getUnitButton(label).click();
  }

  /** Get stat card value by title (e.g. "Total Tokens", "Compute Time", "Cost") */
  async getStatValue(title: string): Promise<string> {
    const card = this.page
      .getByRole("heading", { name: title, level: 3 })
      .locator("xpath=ancestor::div[contains(@class, 'rounded-lg')]")
      .first();
    const value = card.locator("div.text-3xl");
    return ((await value.textContent()) ?? "").trim();
  }

  /** Get the By Source & Model table */
  getModelTable(): Locator {
    return this.page
      .getByRole("heading", { name: "By Source & Model" })
      .locator("xpath=ancestor::div[contains(@class, 'rounded-lg')]")
      .first()
      .locator("table");
  }

  getModelRows(): Locator {
    return this.getModelTable().locator("tbody tr");
  }

  /** Check if the USD-tab empty state ("No billable usage...") is visible */
  async hasUsdEmptyState(): Promise<boolean> {
    return this.page
      .getByText(
        "No billable usage — all current sources are subscription or local.",
      )
      .isVisible();
  }

  /** Check if the no-consumption-data empty state is visible */
  async hasNoDataState(): Promise<boolean> {
    return this.page
      .getByText("No consumption data for this range yet.")
      .isVisible();
  }

  /** Check if error state is visible */
  async hasError(): Promise<boolean> {
    return this.page.getByText("Error", { exact: true }).isVisible();
  }
}
