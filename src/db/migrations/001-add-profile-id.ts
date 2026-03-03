/**
 * Migration 001 — Add profile_id to multi-tenant tables
 *
 * Adds `profile_id TEXT NOT NULL DEFAULT 'default'` to:
 *   activities, sessions, cost_summaries, llm_generations, scan_state
 *
 * Backfills existing rows with profile_id = 'team'.
 * Creates composite index on (profile_id, timestamp DESC) for activities.
 */

import type { Migration } from "../migration-runner.js";
import type { Database as SqliteDatabase } from "sqlite";

/** Tables that receive the profile_id column */
const TABLES = [
  "activities",
  "sessions",
  "cost_summaries",
  "llm_generations",
  "scan_state",
] as const;

/**
 * Check whether a column exists in a table (SQLite PRAGMA).
 */
async function columnExists(
  db: SqliteDatabase,
  table: string,
  column: string,
): Promise<boolean> {
  const cols = await db.all<{ name: string }[]>(`PRAGMA table_info(${table})`);
  return cols.some((c) => c.name === column);
}

/**
 * Check whether a table exists.
 */
async function tableExists(
  db: SqliteDatabase,
  table: string,
): Promise<boolean> {
  const row = await db.get<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name=?",
    table,
  );
  return (row?.cnt ?? 0) > 0;
}

/**
 * Check whether an index exists.
 */
async function indexExists(
  db: SqliteDatabase,
  indexName: string,
): Promise<boolean> {
  const row = await db.get<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='index' AND name=?",
    indexName,
  );
  return (row?.cnt ?? 0) > 0;
}

const migration: Migration = {
  version: "001",
  name: "add-profile-id",

  async up(db: SqliteDatabase): Promise<void> {
    await db.exec("BEGIN TRANSACTION");
    try {
      for (const table of TABLES) {
        // Skip tables that don't exist yet (fresh DB will create them with the column)
        if (!(await tableExists(db, table))) {
          continue;
        }

        // Add column only if it doesn't already exist (idempotent)
        if (!(await columnExists(db, table, "profile_id"))) {
          await db.exec(
            `ALTER TABLE ${table} ADD COLUMN profile_id TEXT NOT NULL DEFAULT 'default'`,
          );
        }

        // Backfill existing data with 'team'
        await db.run(
          `UPDATE ${table} SET profile_id = 'team' WHERE profile_id = 'default'`,
        );
      }

      // Composite index for efficient per-profile queries on activities
      if (!(await indexExists(db, "idx_activities_profile_timestamp"))) {
        await db.exec(
          `CREATE INDEX idx_activities_profile_timestamp ON activities(profile_id, timestamp DESC)`,
        );
      }

      // Composite index for efficient per-profile queries on llm_generations
      if (!(await indexExists(db, "idx_llm_generations_profile_ts"))) {
        await db.exec(
          `CREATE INDEX idx_llm_generations_profile_ts ON llm_generations(profile_id, timestamp DESC)`,
        );
      }

      // Replace scan_state primary key with composite (file_path, profile_id)
      // to support multi-profile scan isolation
      if (await tableExists(db, "scan_state")) {
        const cols = await db.all<{ name: string }[]>(
          "PRAGMA table_info(scan_state)",
        );
        const hasProfileId = cols.some((c) => c.name === "profile_id");
        if (hasProfileId) {
          // Recreate table with composite primary key
          await db.exec(`
            CREATE TABLE IF NOT EXISTS scan_state_new (
              file_path TEXT NOT NULL,
              profile_id TEXT NOT NULL DEFAULT 'default',
              last_offset INTEGER DEFAULT 0,
              last_scanned_at DATETIME,
              file_size INTEGER DEFAULT 0,
              PRIMARY KEY (file_path, profile_id)
            )
          `);
          await db.exec(`
            INSERT OR IGNORE INTO scan_state_new (file_path, profile_id, last_offset, last_scanned_at, file_size)
            SELECT file_path, profile_id, last_offset, last_scanned_at, file_size FROM scan_state
          `);
          await db.exec("DROP TABLE scan_state");
          await db.exec("ALTER TABLE scan_state_new RENAME TO scan_state");
        }
      }

      await db.exec("COMMIT");
    } catch (err) {
      await db.exec("ROLLBACK");
      throw err;
    }
  },
};

export default migration;
