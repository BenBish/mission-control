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
 * BSH-90: Before activity upsert, tool completion events failed UNIQUE
 * (source_id, session_id, external_id) while their natural keys were still
 * recorded in ingest_dedupe. Clear terminal-status activity keys so a
 * collector re-scan (or cursor reset) can re-apply completions onto the
 * existing running rows via upsert.
 */
export async function clearBurnedTerminalActivityDedupeKeys(
  db: SqliteDatabase,
): Promise<void> {
  await db.run(`
    DELETE FROM ingest_dedupe
    WHERE kind = 'activity'
      AND (
        natural_key LIKE '%:success'
        OR natural_key LIKE '%:failure'
        OR natural_key LIKE '%:cancelled'
        OR natural_key LIKE '%:canceled'
      )
  `);
}

/**
 * BSH-141: Tag spend_alert_events with a cost/quota/wallet data class so
 * plan-usage and wallet threshold alerts are never mixed with Direct API Spend.
 */
export async function addSpendAlertDataClass(
  db: SqliteDatabase,
): Promise<void> {
  const cols = await db.all<{ name: string }[]>(
    `PRAGMA table_info(spend_alert_events)`,
  );
  if (!cols.some((c) => c.name === "data_class")) {
    await db.exec(`
      ALTER TABLE spend_alert_events
      ADD COLUMN data_class TEXT NOT NULL DEFAULT 'cost'
    `);
  }
  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_spend_alert_events_data_class
      ON spend_alert_events(data_class, created_at DESC)
  `);
}

/**
 * BSH-141: fingerprint+month_key upsert is SELECT-then-INSERT; concurrent
 * GET /credits and GET /spend-insights can both miss the row. Unique index
 * makes the second insert fail closed instead of duplicating the alert.
 */
export async function addSpendAlertFingerprintUnique(
  db: SqliteDatabase,
): Promise<void> {
  await db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_spend_alert_events_fingerprint_unique
      ON spend_alert_events(fingerprint, month_key)
  `);
}

/**
 * BSH-422: Allow 'devin' in the provider CHECK constraints so Devin plan-
 * usage snapshots (bridged from collector quota_snapshots) can persist.
 * SQLite cannot alter CHECK constraints — rebuild the three provider tables
 * when their definition still lacks 'devin'.
 */
export async function addDevinProviderId(db: SqliteDatabase): Promise<void> {
  const tableSql = async (name: string): Promise<string> => {
    const row = await db.get<{ sql: string }>(
      `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`,
      name,
    );
    return row?.sql ?? "";
  };

  const rebuilds: Array<{
    table: string;
    create: string;
    columns: string;
    indexes: string[];
  }> = [
    {
      table: "provider_usage_daily",
      create: `CREATE TABLE provider_usage_daily_new (
  provider TEXT NOT NULL CHECK (provider IN ('openrouter', 'anthropic', 'openai', 'xai', 'devin')),
  day TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL,
  request_count INTEGER NOT NULL DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (provider, day, model)
)`,
      columns:
        "provider, day, model, input_tokens, output_tokens, cost_usd, request_count, updated_at",
      indexes: [
        "CREATE INDEX IF NOT EXISTS idx_provider_usage_day ON provider_usage_daily(day DESC)",
        "CREATE INDEX IF NOT EXISTS idx_provider_usage_provider ON provider_usage_daily(provider, day DESC)",
      ],
    },
    {
      table: "provider_sync_status",
      create: `CREATE TABLE provider_sync_status_new (
  provider TEXT PRIMARY KEY CHECK (provider IN ('openrouter', 'anthropic', 'openai', 'xai', 'devin')),
  status TEXT NOT NULL DEFAULT 'not_configured'
    CHECK (status IN ('not_configured', 'ok', 'limited', 'error', 'syncing')),
  last_sync_at DATETIME,
  last_success_at DATETIME,
  last_error TEXT,
  cursor_day TEXT,
  meta_json TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`,
      columns:
        "provider, status, last_sync_at, last_success_at, last_error, cursor_day, meta_json, updated_at",
      indexes: [],
    },
    {
      table: "provider_credit_snapshots",
      create: `CREATE TABLE provider_credit_snapshots_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL CHECK (provider IN ('openrouter', 'anthropic', 'openai', 'xai', 'devin')),
  as_of DATETIME NOT NULL,
  remaining REAL,
  total REAL,
  unit TEXT NOT NULL CHECK (unit IN ('usd', 'credits', 'requests', 'tokens', 'percent')),
  label TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('provider_api', 'session_quota', 'unavailable')),
  status TEXT NOT NULL CHECK (status IN ('ok', 'limited', 'unavailable', 'error')),
  details_json TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (provider, label, as_of)
)`,
      columns:
        "id, provider, as_of, remaining, total, unit, label, source, status, details_json, updated_at",
      indexes: [
        "CREATE INDEX IF NOT EXISTS idx_provider_credit_provider ON provider_credit_snapshots(provider, as_of DESC)",
        "CREATE INDEX IF NOT EXISTS idx_provider_credit_label ON provider_credit_snapshots(provider, label, as_of DESC)",
      ],
    },
  ];

  for (const r of rebuilds) {
    const sql = await tableSql(r.table);
    if (!sql) continue; // table absent — base schema will create it fresh
    if (sql.includes("'devin'")) continue; // already allows devin
    await db.exec("BEGIN");
    try {
      await db.exec(r.create);
      await db.exec(
        `INSERT INTO ${r.table}_new (${r.columns}) SELECT ${r.columns} FROM ${r.table}`,
      );
      await db.exec(`DROP TABLE ${r.table}`);
      await db.exec(`ALTER TABLE ${r.table}_new RENAME TO ${r.table}`);
      for (const idx of r.indexes) await db.exec(idx);
      await db.exec("COMMIT");
    } catch (err) {
      await db.exec("ROLLBACK");
      throw err;
    }
  }
}

const MIGRATIONS: Migration[] = [
  {
    version: "001",
    name: "normalize-grok-cache-inclusive-input-tokens",
    up: normalizeGrokCacheInclusiveInputTokens,
  },
  {
    version: "002",
    name: "clear-burned-terminal-activity-dedupe-keys",
    up: clearBurnedTerminalActivityDedupeKeys,
  },
  {
    version: "003",
    name: "spend-alert-data-class",
    up: addSpendAlertDataClass,
  },
  {
    version: "004",
    name: "spend-alert-fingerprint-unique",
    up: addSpendAlertFingerprintUnique,
  },
  {
    version: "005",
    name: "add-devin-provider-id",
    up: addDevinProviderId,
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
