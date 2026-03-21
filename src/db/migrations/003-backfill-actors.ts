/**
 * Migration 003 — Backfill actors_json from session IDs
 *
 * Existing sessions have `actors_json = NULL`. This migration extracts the
 * agent ID from session IDs matching the `agent:<id>:...` pattern and
 * populates actors_json with an initial actor entry.
 */

import type { Migration } from "../migration-runner.js";
import type { Database as SqliteDatabase } from "sqlite";

const migration: Migration = {
  version: "003",
  name: "backfill-actors",

  async up(db: SqliteDatabase): Promise<void> {
    // Fetch sessions with NULL actors_json whose IDs match the agent pattern
    const rows = await db.all<{ id: string }[]>(
      `SELECT id FROM sessions WHERE actors_json IS NULL AND id LIKE 'agent:%'`,
    );

    for (const row of rows) {
      const match = row.id.match(/^agent:([^:]+):/);
      if (!match) continue;

      const actorId = match[1];
      const actorsJson = JSON.stringify({
        [actorId]: {
          id: actorId,
          type: "orchestrator",
          actionsCount: 0,
          successCount: 0,
          tokensUsed: 0,
          costUsd: 0,
        },
      });

      await db.run(
        `UPDATE sessions SET actors_json = ? WHERE id = ?`,
        actorsJson,
        row.id,
      );
    }
  },
};

export default migration;
