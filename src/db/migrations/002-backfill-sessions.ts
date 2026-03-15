/**
 * Migration 002 — Backfill sessions from activities
 *
 * The `sessions` table may be empty even though `activities` has rows with
 * `session_id` values.  This migration creates session rows by aggregating
 * activity data, using INSERT OR IGNORE so it is idempotent.
 */

import type { Migration } from "../migration-runner.js";
import type { Database as SqliteDatabase } from "sqlite";

const migration: Migration = {
  version: "002",
  name: "backfill-sessions",

  async up(db: SqliteDatabase): Promise<void> {
    await db.exec(`
      INSERT OR IGNORE INTO sessions (
        id, profile_id, start_time, end_time,
        total_actions, success_count, failure_count,
        total_cost_usd, total_tokens, actors_json, top_tools_json
      )
      SELECT
        session_id AS id,
        profile_id,
        MIN(timestamp) AS start_time,
        MAX(COALESCE(completed_at, timestamp)) AS end_time,
        COUNT(*) AS total_actions,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success_count,
        SUM(CASE WHEN status = 'failure' THEN 1 ELSE 0 END) AS failure_count,
        COALESCE(SUM(cost_usd), 0) AS total_cost_usd,
        COALESCE(SUM(total_tokens), 0) AS total_tokens,
        NULL AS actors_json,
        NULL AS top_tools_json
      FROM activities
      WHERE session_id IS NOT NULL
        AND session_id != ''
      GROUP BY session_id, profile_id
    `);
  },
};

export default migration;
