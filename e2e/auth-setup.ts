/**
 * Auth setup project — authenticates and saves storage state.
 * Runs after webServer is ready, before actual tests.
 */

import { test as setup, expect } from "@playwright/test";
import { TEST_CREDENTIALS } from "./fixtures/test-data.js";
import { STORAGE_STATE_PATH } from "./fixtures/base.js";
import fs from "fs";
import path from "path";

setup("authenticate", async ({ request }) => {
  // Ensure auth storage directory exists
  fs.mkdirSync(path.dirname(STORAGE_STATE_PATH), { recursive: true });

  // Authenticate via API and store cookies
  const loginResponse = await request.post("/api/auth/login", {
    data: {
      username: TEST_CREDENTIALS.username,
      password: TEST_CREDENTIALS.password,
    },
  });
  expect(loginResponse.ok()).toBeTruthy();

  // Save storage state (cookies) for reuse
  await request.storageState({ path: STORAGE_STATE_PATH });
});
