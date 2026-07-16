/**
 * Database connection wrapper — open/close/migrate only.
 * All query logic lives in src/db/queries/*.ts, operating on the raw
 * sqlite Database handle exposed via .raw().
 */

import sqlite3 from "sqlite3";
import { open, Database as SqliteDatabase } from "sqlite";
import { getSQLStatements } from "./schema.js";
import {
  runMigrations as runSchemaMigrations,
  type Migration,
} from "./migration-runner.js";
import { seedSources } from "./queries/sources.js";

/**
 * BSH-55: Pre-fix Grok collector stored cache-inclusive inputTokens while
 * also storing cache_read_tokens. Subtract cache on rows that still have the
 * old shape: input + output ≈ total (cache rolled into input). Already
 * normalized rows keep total ≈ input + output + cache, so they do not match.
 */
export async function normalizeGrokCacheInclusiveInputTokens(
  db: SqliteDatabase,
): Promise<void> {
  await db.run(`
    UPDATE activities
    SET input_tokens = input_tokens - cache_read_tokens
    WHERE source_id = 'grok'
      AND cache_read_tokens IS NOT NULL
      AND cache_read_tokens > 0
      AND input_tokens IS NOT NULL
      AND total_tokens IS NOT NULL
      AND ABS(
        (input_tokens + COALESCE(output_tokens, 0)) - total_tokens
      ) <= 1
  `);

  // Sessions have no total_tokens column. Rebuild counters from activities
  // after the activity fix so we never double-subtract exclusive session rows.
  await db.run(`
    UPDATE sessions
    SET
      input_tokens = (
        SELECT COALESCE(SUM(COALESCE(a.input_tokens, 0)), 0)
        FROM activities a
        WHERE a.session_id = sessions.id
      ),
      output_tokens = (
        SELECT COALESCE(SUM(COALESCE(a.output_tokens, 0)), 0)
        FROM activities a
        WHERE a.session_id = sessions.id
      ),
      cache_read_tokens = (
        SELECT COALESCE(SUM(COALESCE(a.cache_read_tokens, 0)), 0)
        FROM activities a
        WHERE a.session_id = sessions.id
      )
    WHERE source_id = 'grok'
      AND EXISTS (
        SELECT 1
        FROM activities a
        WHERE a.session_id = sessions.id
          AND (
            COALESCE(a.input_tokens, 0) > 0
            OR COALESCE(a.output_tokens, 0) > 0
            OR COALESCE(a.cache_read_tokens, 0) > 0
          )
      )
  `);
}

/**
 * Versioned data/schema migrations. Base tables come from schema.ts;
 * this list is for changes after the baseline.
 */
const MIGRATIONS: Migration[] = [
  {
    version: "001",
    name: "normalize-grok-cache-inclusive-input-tokens",
    up: normalizeGrokCacheInclusiveInputTokens,
  },
];

export class Database {
  private db: SqliteDatabase | null = null;

  constructor(private dbPath: string) {}

  async initialize(): Promise<void> {
    this.db = await open({
      filename: this.dbPath,
      driver: sqlite3.Database,
    });

    await this.migrate();
    await seedSources(this.db);
    console.log(`✓ Database initialized at ${this.dbPath}`);
  }

  private async migrate(): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");

    // Base schema (CREATE TABLE IF NOT EXISTS — idempotent)
    const statements = getSQLStatements();
    for (const stmt of statements) {
      await this.db.exec(stmt);
    }

    await runSchemaMigrations(this.db, MIGRATIONS);
  }

  async close(): Promise<void> {
    if (this.db) {
      try {
        await this.db.exec("PRAGMA integrity_check");
        await this.db.close();
      } catch (error) {
        console.warn("Error closing database:", error);
      } finally {
        this.db = null;
      }
    }
  }

  /** Raw sqlite handle for query modules under src/db/queries/. */
  raw(): SqliteDatabase {
    if (!this.db) throw new Error("Database not initialized");
    return this.db;
  }
}
