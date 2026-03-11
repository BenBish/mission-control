/**
 * Playwright globalSetup — seeds test database before servers start.
 */

import { seedDatabase } from "./helpers/db-seeder.js";
import path from "path";
import fs from "fs";

export default async function globalSetup() {
  await seedDatabase();

  const dbPath = path.resolve("./test-data/playwright.db");
  const stat = fs.statSync(dbPath);
  console.log(`✓ Test database seeded at ${dbPath} (${stat.size} bytes)`);
}
