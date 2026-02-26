/**
 * Database Migration Runner
 * Versioned migration framework for SQLite schema changes.
 *
 * - Tracks applied migrations in a `schema_migrations` table
 * - Runs automatically on server startup
 * - Idempotent: safe to run multiple times
 */

import type { Database as SqliteDatabase } from "sqlite";

export interface Migration {
  /** Unique version identifier (e.g. "001") */
  version: string;
  /** Human-readable name */
  name: string;
  /** Apply the migration. Receives the raw sqlite Database handle. */
  up(db: SqliteDatabase): Promise<void>;
}

/**
 * Ensure the schema_migrations tracking table exists.
 */
async function ensureMigrationsTable(db: SqliteDatabase): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

/**
 * Return set of already-applied migration versions.
 */
async function getAppliedVersions(db: SqliteDatabase): Promise<Set<string>> {
  const rows = await db.all<{ version: string }[]>(
    "SELECT version FROM schema_migrations ORDER BY version",
  );
  return new Set(rows.map((r) => r.version));
}

/**
 * Run all pending migrations in order.
 * Returns the number of newly applied migrations.
 */
export async function runMigrations(
  db: SqliteDatabase,
  migrations: Migration[],
): Promise<number> {
  await ensureMigrationsTable(db);
  const applied = await getAppliedVersions(db);

  // Sort by version to guarantee order
  const sorted = [...migrations].sort((a, b) =>
    a.version.localeCompare(b.version),
  );

  let count = 0;
  for (const migration of sorted) {
    if (applied.has(migration.version)) {
      continue;
    }

    console.log(
      `  ↗ Running migration ${migration.version}: ${migration.name}`,
    );
    await migration.up(db);

    await db.run(
      "INSERT INTO schema_migrations (version, name) VALUES (?, ?)",
      migration.version,
      migration.name,
    );
    count++;
  }

  if (count > 0) {
    console.log(`  ✓ Applied ${count} migration(s)`);
  } else {
    console.log("  ✓ All migrations up to date");
  }

  return count;
}
