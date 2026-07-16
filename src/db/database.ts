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
 * Versioned data/schema migrations. Base tables come from schema.ts;
 * this list is for changes after the baseline.
 */
const MIGRATIONS: Migration[] = [
  {
    version: "001",
    name: "normalize-grok-cache-inclusive-input-tokens",
    async up(db) {
      // Pre-BSH-55 Grok collector stored cache-inclusive inputTokens on
      // activities/sessions while also storing cache_read_tokens. Subtract
      // cache so SUM(input_tokens) matches Claude-style non-cached input.
      // Safe on empty tables and on already-normalized rows (no match).
      await db.run(`
        UPDATE activities
        SET input_tokens = input_tokens - cache_read_tokens
        WHERE source_id = 'grok'
          AND cache_read_tokens IS NOT NULL
          AND cache_read_tokens > 0
          AND input_tokens IS NOT NULL
          AND input_tokens >= cache_read_tokens
      `);
      await db.run(`
        UPDATE sessions
        SET input_tokens = input_tokens - cache_read_tokens
        WHERE source_id = 'grok'
          AND cache_read_tokens IS NOT NULL
          AND cache_read_tokens > 0
          AND input_tokens IS NOT NULL
          AND input_tokens >= cache_read_tokens
      `);
    },
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
