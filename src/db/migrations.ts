/**
 * Database Migrations
 * Handles schema initialization and upgrades
 */

import { Database } from './database.js';

/**
 * Run all migrations
 */
export async function runMigrations(dbPath: string = './data/mission-control.db'): Promise<void> {
  const db = new Database(dbPath);
  await db.initialize();
  console.log('✓ All migrations completed');
  await db.close();
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const dbPath = process.argv[2] || './data/mission-control.db';
  runMigrations(dbPath)
    .then(() => {
      console.log('✓ Database ready');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}

export { runMigrations };
