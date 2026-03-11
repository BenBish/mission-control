/**
 * Playwright globalSetup — verify test database exists.
 * Seeding is done in the webServer command (before API starts) to avoid
 * race conditions between globalSetup and webServer startup.
 */

import path from "path";
import fs from "fs";

export default async function globalSetup() {
  const dbPath = path.resolve("./test-data/playwright.db");
  if (fs.existsSync(dbPath)) {
    const stat = fs.statSync(dbPath);
    console.log(`✓ Test database exists at ${dbPath} (${stat.size} bytes)`);
  } else {
    console.log(
      `⚠ Test database not found at ${dbPath} — webServer will create it`,
    );
  }
}
