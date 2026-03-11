import { seedDatabase } from "./helpers/db-seeder.js";

await seedDatabase();
console.log("✓ Test database seeded");
