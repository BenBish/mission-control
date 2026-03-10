/**
 * Playwright globalTeardown — cleans up test database.
 */

import { cleanDatabase } from "./helpers/db-seeder.js";

export default async function globalTeardown() {
  await cleanDatabase();
  console.log("✓ Test database cleaned up");
}
