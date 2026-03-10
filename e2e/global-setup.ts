/**
 * Playwright globalSetup — seeds test database before servers start.
 */

import { seedDatabase } from "./helpers/db-seeder.js";

export default async function globalSetup() {
  await seedDatabase();
  console.log("✓ Test database seeded");
}
