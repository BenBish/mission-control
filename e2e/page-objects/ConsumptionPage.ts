/**
 * ConsumptionPage — page object for the Consumption view (src/pages/Consumption.tsx).
 * Tabs: Agent Usage, Plan usage & wallet, Direct API Spend, and Attribution.
 * View + range (+ unit on Agent Usage) are encoded in the URL.
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

  async goto(query?: string) {
    await super.goto(query ? `/consumption${query}` : "/consumption");
  }

  /** Wait for consumption data to load (past the initial Loading spinner) */
  async waitForData() {
    await this.heading.waitFor({ state: "visible" });
    // Agent Usage default shows a stat/table/empty; Direct API shows its heading.
    // Any of these means the first fetch cycle finished — not just the page shell.
    await this.page
      .getByRole("heading", { name: "Total Tokens", level: 3 })
      .or(this.page.getByRole("heading", { name: "Compute Time", level: 3 }))
      .or(this.page.getByRole("heading", { name: "Cost", level: 3 }))
      .or(
        this.page.getByRole("heading", { name: "By Source & Model", level: 3 }),
      )
      .or(this.page.getByRole("heading", { name: "Ranked drivers", level: 3 }))
      .or(
        this.page.getByRole("heading", { name: "Direct API Spend", level: 3 }),
      )
      .or(this.page.getByTestId("direct-api-overview"))
      .or(this.page.getByTestId("plan-wallet-capacity-section"))
      .or(this.page.getByTestId("attribution-panel"))
      .or(this.agentUsdEmptyState())
      .or(this.noDataState())
      .first()
      .waitFor({ state: "visible" });
  }

  getTab(
    name:
      | "Agent Usage"
      | "Plan usage & wallet"
      | "Direct API Spend"
      | "Attribution",
  ): Locator {
    return this.page.getByRole("tab", { name, exact: true });
  }

  async selectTab(
    name:
      | "Agent Usage"
      | "Plan usage & wallet"
      | "Direct API Spend"
      | "Attribution",
  ) {
    await this.getTab(name).click();
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
    // Unit is encoded in the URL; wait so the UI has committed the switch.
    const unitParam =
      label === "Tokens"
        ? "tokens"
        : label === "Compute time"
          ? "compute"
          : "usd";
    await this.page.waitForURL(new RegExp(`[?&]unit=${unitParam}(?:&|$)`));
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

  /** Get the ranked Agent Usage drivers table (BSH-99) */
  getModelTable(): Locator {
    return this.page
      .getByRole("heading", { name: "Ranked drivers" })
      .or(this.page.getByRole("heading", { name: "By Source & Model" }))
      .locator("xpath=ancestor::div[contains(@class, 'rounded-lg')]")
      .first()
      .locator("table")
      .first();
  }

  getModelRows(): Locator {
    // Only top-level driver rows (not drill-down nested tables)
    return this.getModelTable()
      .locator("> tbody > tr")
      .filter({
        has: this.page.locator("td").nth(1),
      });
  }

  getCoverageUnattributed(): Locator {
    return this.page.getByRole("heading", {
      name: "Unattributed",
      level: 3,
    });
  }

  getDimensionButton(label: string): Locator {
    return this.page.getByRole("button", { name: label, exact: true });
  }

  /** Agent Usage USD empty state (session-log cost only) */
  agentUsdEmptyState(): Locator {
    return this.page.getByText(/No billable agent usage in this range/i);
  }

  /** Check if the no-agent-usage-data empty state is visible */
  noDataState(): Locator {
    return this.page.getByText(/No Agent Usage data for this range/i);
  }

  /** Check if error state is visible */
  errorState(): Locator {
    return this.page.getByText("Error", { exact: true });
  }

  /** Select a source from the global source filter (header combobox) */
  async selectSourceFilter(sourceName: string) {
    const trigger = this.page.getByRole("combobox").first();
    await trigger.click();
    await this.page.getByRole("option", { name: sourceName }).click();
  }

  /** Reset source filter to all sources */
  async selectAllSourcesFilter() {
    await this.selectSourceFilter("All sources");
  }
}
