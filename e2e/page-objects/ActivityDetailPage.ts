/**
 * ActivityDetailPage — page object for the Activity Detail view.
 */

import { type Page, type Locator } from "@playwright/test";
import { BasePage } from "./BasePage.js";

export class ActivityDetailPage extends BasePage {
  readonly backButton: Locator;

  constructor(page: Page) {
    super(page);
    this.backButton = page.getByRole("button", { name: "Back" });
  }

  async goto(activityId: string) {
    await super.goto(`/activities/${activityId}`);
  }

  /** Wait for the detail view to load — wait for Back button and a card heading */
  async waitForDetail() {
    await this.backButton.waitFor({ state: "visible" });
    // Wait for the Actor heading which appears in the info cards grid
    await this.page
      .getByRole("heading", { name: "Actor", level: 3 })
      .waitFor({ state: "visible" });
  }

  /** Get the activity description text from the main heading */
  async getDescription(): Promise<string> {
    // The description is the first h3 on the page (inside the main card header)
    const heading = this.page
      .locator("main")
      .getByRole("heading", { level: 3 })
      .first();
    return ((await heading.textContent()) ?? "").trim();
  }

  /** Get the activity ID displayed */
  async getActivityId(): Promise<string> {
    const idEl = this.page.locator("span.font-mono.text-xs").first();
    return ((await idEl.textContent()) ?? "").trim();
  }

  /** Get the status badge text */
  async getStatus(): Promise<string> {
    const statusBadge = this.page.locator("[class*='capitalize']").first();
    return ((await statusBadge.textContent()) ?? "").trim().toLowerCase();
  }

  /** Check if the Actor card is visible */
  async hasActorCard(): Promise<boolean> {
    return this.page
      .getByRole("heading", { name: "Actor", level: 3 })
      .isVisible();
  }

  /** Check if the Action card is visible */
  async hasActionCard(): Promise<boolean> {
    return this.page
      .getByRole("heading", { name: "Action", level: 3 })
      .isVisible();
  }

  /** Check if the Timing card is visible */
  async hasTimingCard(): Promise<boolean> {
    return this.page
      .getByRole("heading", { name: "Timing", level: 3 })
      .isVisible();
  }

  /** Check if the Session card is visible */
  async hasSessionCard(): Promise<boolean> {
    return this.page
      .getByRole("heading", { name: "Session", level: 3 })
      .isVisible();
  }

  /** Get the session ID from the Session card */
  async getSessionId(): Promise<string> {
    const sessionCard = this.page
      .getByRole("heading", { name: "Session", level: 3 })
      .locator("xpath=ancestor::div[contains(@class, 'rounded-lg')]")
      .first();
    const code = sessionCard.locator("code");
    return ((await code.textContent()) ?? "").trim();
  }

  /** Click the back button */
  async goBack() {
    await this.backButton.click();
  }

  /** Check if error state is visible */
  async hasError(): Promise<boolean> {
    return this.page.getByText("Error").isVisible();
  }

  /** Check if 404/not-found state is visible */
  async hasNotFound(): Promise<boolean> {
    return this.page.getByText("Not found").isVisible();
  }
}
