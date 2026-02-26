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
  const cols = await db.all<{ name: string }[]>(
    `PRAGMA table_info(${table})`,
  );
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
  },
};

export default migration;
