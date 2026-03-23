/**
 * SessionDetailPage — page object for the Session Detail view.
 */

import { type Page, type Locator } from "@playwright/test";
import { BasePage } from "./BasePage.js";

export class SessionDetailPage extends BasePage {
  readonly backButton: Locator;
  readonly tabsList: Locator;

  constructor(page: Page) {
    super(page);
    this.backButton = page.getByRole("button", { name: /Back to Sessions/i });
    this.tabsList = page.getByRole("tablist");
  }

  async goto(sessionId: string) {
    await super.goto(`/sessions/${sessionId}`);
  }

  async waitForDetail() {
    await this.backButton.waitFor({ state: "visible", timeout: 10000 });
    await this.tabsList.waitFor({ state: "visible" });
  }

  async clickTab(name: string) {
    await this.page.getByRole("tab", { name }).click();
  }

  async getTabNames(): Promise<string[]> {
    const tabs = this.page.getByRole("tab");
    const count = await tabs.count();
    const names: string[] = [];
    for (let i = 0; i < count; i++) {
      names.push(((await tabs.nth(i).textContent()) ?? "").trim());
    }
    return names;
  }

  async isTimelineTabVisible(): Promise<boolean> {
    return this.page.getByRole("tab", { name: "Timeline" }).isVisible();
  }

  async getTimelineSwimlanes(): Promise<Locator> {
    return this.page.getByTestId("timeline-swimlanes");
  }

  async getTimelineLanes(): Promise<number> {
    const lanes = this.page.locator("[data-testid^='timeline-lane-']");
    return lanes.count();
  }

  async getTimelinePills(): Promise<number> {
    const pills = this.page.locator("[data-testid^='timeline-pill-']");
    return pills.count();
  }

  async getTimelineDots(): Promise<number> {
    const dots = this.page.locator("[data-testid^='timeline-dot-']");
    return dots.count();
  }

  async hasCostDistributionBar(): Promise<boolean> {
    return this.page.getByTestId("cost-distribution-bar").isVisible();
  }

  async hasSummaryBar(): Promise<boolean> {
    const totalDuration = this.page.getByText("Total Duration");
    return totalDuration.isVisible();
  }
}
