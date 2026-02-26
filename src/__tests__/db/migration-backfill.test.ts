/**
 * Migration Backfill Tests (ORC-45 AC 3)
 * Verifies that existing data is backfilled with profile_id = 'team'
 */

import sqlite3 from "sqlite3";
import { open } from "sqlite";
import { Database } from "../../db/database.js";
import * as fs from "fs";

const TEST_DB_PATH = "./test-data/test-migration-backfill.db";

describe("Migration Backfill (AC 3)", () => {
  beforeAll(() => {
    if (!fs.existsSync("./test-data")) {
      fs.mkdirSync("./test-data", { recursive: true });
    }
  });

  afterAll(() => {
    for (const suffix of ["", "-wal", "-shm"]) {
      const f = `${TEST_DB_PATH}${suffix}`;
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
  });

  test("existing data is backfilled with profile_id = 'team'", async () => {
    // Clean up any prior test db
    for (const suffix of ["", "-wal", "-shm"]) {
      const f = `${TEST_DB_PATH}${suffix}`;
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }

    // Step 1: Create a database with the OLD schema (no profile_id)
    const rawDb = await open({
      filename: TEST_DB_PATH,
      driver: sqlite3.Database,
    });

    await rawDb.exec("PRAGMA journal_mode=WAL");

    // Create tables WITHOUT profile_id (simulating pre-migration schema)
    await rawDb.exec(`
      CREATE TABLE IF NOT EXISTS activities (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        parent_activity_id TEXT,
        timestamp DATETIME NOT NULL,
        completed_at DATETIME,
        duration_ms INTEGER,
        actor_type TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        actor_role TEXT,
        actor_session_label TEXT,
        action_type TEXT NOT NULL,
        tool_name TEXT,
        description TEXT NOT NULL,
        details JSON,
        status TEXT NOT NULL,
        result JSON,
        input_tokens INTEGER,
        output_tokens INTEGER,
        total_tokens INTEGER,
        model TEXT,
        cost_usd REAL,
        tags TEXT,
        references_json JSON,
        metadata JSON,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await rawDb.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        start_time DATETIME NOT NULL,
        end_time DATETIME,
        total_actions INTEGER DEFAULT 0,
        success_count INTEGER DEFAULT 0,
        failure_count INTEGER DEFAULT 0,
        total_tokens INTEGER DEFAULT 0,
        total_cost_usd REAL DEFAULT 0.0,
        avg_action_duration_ms REAL DEFAULT 0,
        actors_json JSON,
        top_tools_json JSON,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await rawDb.exec(`
      CREATE TABLE IF NOT EXISTS cost_summaries (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        actor_id TEXT,
        summary_date DATE NOT NULL,
        action_count INTEGER DEFAULT 0,
        total_cost_usd REAL DEFAULT 0.0,
        total_tokens INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await rawDb.exec(`
      CREATE TABLE IF NOT EXISTS llm_generations (
        id TEXT PRIMARY KEY,
        session_log_file TEXT NOT NULL,
        session_log_msg_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        timestamp DATETIME NOT NULL,
        model TEXT NOT NULL,
        provider TEXT,
        stop_reason TEXT,
        input_tokens INTEGER DEFAULT 0,
        output_tokens INTEGER DEFAULT 0,
        cache_read_tokens INTEGER DEFAULT 0,
        cache_write_tokens INTEGER DEFAULT 0,
        total_tokens INTEGER DEFAULT 0,
        cost_input REAL DEFAULT 0,
        cost_output REAL DEFAULT 0,
        cost_cache_read REAL DEFAULT 0,
        cost_total REAL DEFAULT 0,
        linked_activity_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(session_log_file, session_log_msg_id)
      );
    `);

    await rawDb.exec(`
      CREATE TABLE IF NOT EXISTS scan_state (
        file_path TEXT PRIMARY KEY,
        last_offset INTEGER DEFAULT 0,
        last_scanned_at DATETIME,
        file_size INTEGER DEFAULT 0
      );
    `);

    // Also need activity_logs for the full schema
    await rawDb.exec(`
      CREATE TABLE IF NOT EXISTS activity_logs (
        id TEXT PRIMARY KEY,
        activity_id TEXT NOT NULL,
        stdout TEXT,
        stderr TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Step 2: Insert pre-existing data (no profile_id column)
    await rawDb.run(
      "INSERT INTO activities (id, session_id, timestamp, actor_type, actor_id, action_type, description, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      "act-001",
      "sess-001",
      "2024-01-15T10:00:00Z",
      "subagent",
      "engineer",
      "tool_call",
      "Old activity",
      "success",
    );

    await rawDb.run(
      "INSERT INTO sessions (id, start_time) VALUES (?, ?)",
      "sess-001",
      "2024-01-15T09:00:00Z",
    );

    await rawDb.run(
      "INSERT INTO llm_generations (id, session_log_file, session_log_msg_id, agent_id, timestamp, model) VALUES (?, ?, ?, ?, ?, ?)",
      "gen-001",
      "/logs/old.jsonl",
      "msg-001",
      "engineer",
      "2024-01-15T10:00:00Z",
      "claude-sonnet-4-20250514",
    );

    await rawDb.run(
      "INSERT INTO scan_state (file_path, last_offset, file_size) VALUES (?, ?, ?)",
      "/logs/old.jsonl",
      1024,
      2048,
    );

    await rawDb.close();

    // Step 3: Open with the Database class (which runs migrations)
    const db = new Database(TEST_DB_PATH);
    await db.initialize();

    // Step 4: Verify backfill — all old data should have profile_id = 'team'
    const activities = await db.getActivities({ profileId: "team" });
    expect(activities.length).toBe(1);
    expect(activities[0].id).toBe("act-001");
    expect(activities[0].profileId).toBe("team");

    // Verify the raw row
    const rawActivity = await (db as any).db.get(
      "SELECT profile_id FROM activities WHERE id = 'act-001'",
    );
    expect(rawActivity.profile_id).toBe("team");

    const rawSession = await (db as any).db.get(
      "SELECT profile_id FROM sessions WHERE id = 'sess-001'",
    );
    expect(rawSession.profile_id).toBe("team");

    const rawGen = await (db as any).db.get(
      "SELECT profile_id FROM llm_generations WHERE id = 'gen-001'",
    );
    expect(rawGen.profile_id).toBe("team");

    const rawScan = await (db as any).db.get(
      "SELECT profile_id FROM scan_state WHERE file_path = '/logs/old.jsonl'",
    );
    expect(rawScan.profile_id).toBe("team");

    await db.close();
  });
});
