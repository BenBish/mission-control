import { defineConfig, devices } from "@playwright/test";
import path from "path";

const isCI = !!process.env.CI;
const STORAGE_STATE = path.resolve("./e2e/.auth/storage-state.json");

export default defineConfig({
  testDir: "./e2e/tests",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  reporter: [
    ["html", { outputFolder: "e2e/playwright-report", open: "never" }],
  ],

  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",

  use: {
    baseURL: "http://localhost:3050",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  outputDir: "e2e/test-results",

  projects: [
    {
      name: "auth-setup",
      testDir: "./e2e",
      testMatch: "auth-setup.ts",
    },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: STORAGE_STATE,
      },
      dependencies: ["auth-setup"],
    },
  ],

  webServer: [
    {
      command:
        "mkdir -p test-data && DATABASE_PATH=./test-data/playwright.db bun run e2e/seed-db.ts && PORT=3051 DATABASE_PATH=./test-data/playwright.db MC_AUTH_ENABLED=true MC_USERNAME=admin MC_PASSWORD_HASH='$argon2id$v=19$m=65536,t=2,p=1$Q8wa6rNQgE6LEgPI+USz0vYKIBenPFGPROJUlvbrIh4$ED0rkFmZ9sktgbff2/5oXDITf9FC+315SXfGMa4QfXk' MC_JWT_SECRET=test-secret-for-e2e SCAN_INTERVAL_MS=86400000 HOME=/tmp/mc-e2e-home bun run src/api/server.ts",
      port: 3051,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "VITE_PORT=3050 VITE_API_PORT=3051 bunx vite",
      port: 3050,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
