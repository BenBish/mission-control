/**
 * Extended Playwright test fixture that handles authentication.
 * Authenticates once and reuses storage state for all tests.
 */

import { test as base, expect } from "@playwright/test";
import path from "path";
import { TEST_CREDENTIALS } from "./test-data.js";

const STORAGE_STATE_PATH = path.resolve("./e2e/.auth/storage-state.json");

/**
 * Authenticate and save storage state.
 * Called once by the setup project.
 */
export async function authenticate(
  request: import("@playwright/test").APIRequestContext,
) {
  const response = await request.post("/api/auth/login", {
    data: {
      username: TEST_CREDENTIALS.username,
      password: TEST_CREDENTIALS.password,
    },
  });
  expect(response.ok()).toBeTruthy();
}

export const test = base.extend({});
export { expect };
export { STORAGE_STATE_PATH };
