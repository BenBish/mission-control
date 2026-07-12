/**
 * Database connection wrapper — open/close/migrate only.
 * All query logic lives in src/db/queries/*.ts, operating on the raw
 * sqlite Database handle exposed via .raw().
 */

import sqlite3 from "sqlite3";
import { open, Database as SqliteDatabase } from "sqlite";
import { getSQLStatements } from "./schema.js";
import { runMigrations as runSchemaMigrations } from "./migration-runner.js";
import { seedSources } from "./queries/sources.js";

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

    // Versioned migrations — none yet. This is a fresh baseline (no
    // OpenClaw-era history to backfill); the next real schema change gets
    // its own migration file here.
    await runSchemaMigrations(this.db, []);
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
