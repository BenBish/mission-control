/**
 * OpenCode desktop collector — reads ~/.local/share/opencode/opencode.db
 * incrementally and emits session + activity ingest events.
 *
 * Uses bun:sqlite in readonly mode so we never contend with OpenCode's WAL
 * writer. Cursor state is stored in CollectorStateStore aggregates (not
 * file-byte offsets — this source is SQLite, not JSONL).
 */

import fs from "fs";
import os from "os";
import path from "path";
import { Database } from "bun:sqlite";
import type { Collector, TickResult } from "../core/types.js";
import type { IngestEvent, Sink } from "../../types/ingest.js";
import { CollectorStateStore } from "../core/state-store.js";
import { sendBatched } from "../core/scheduler.js";
import {
  advanceTableCursor,
  normalizeCursor,
  parseMessage,
  parseToolPart,
  sessionToIngestEvent,
  textFromPartData,
  type OpenCodeDbCursor,
  type OpenCodeMessageRow,
  type OpenCodePartRow,
  type OpenCodeSessionCounts,
  type OpenCodeSessionRow,
} from "./parser.js";

const SOURCE_ID = "opencode";
const INSTANCE_ID = "opencode@arch-desktop";
const COLLECTOR_VERSION = "0.1.0";
const DEFAULT_DB_PATH = path.join(
  os.homedir(),
  ".local",
  "share",
  "opencode",
  "opencode.db",
);
const CURSOR_KEY = `${SOURCE_ID}:db-cursor`;
/** Cap events per tick so a first-run backfill does not monopolize the sink. */
const MAX_PARTS_PER_TICK = 2_000;
const MAX_MESSAGES_PER_TICK = 1_000;
const MAX_SESSIONS_PER_TICK = 200;

interface StateStore {
  getAggregate: CollectorStateStore["getAggregate"];
  setAggregate: CollectorStateStore["setAggregate"];
  persist: CollectorStateStore["persist"];
}

export class OpenCodeCollector implements Collector {
  sourceId = SOURCE_ID;
  instanceId = INSTANCE_ID;
  intervalMs = 30_000;

  constructor(
    private state: StateStore,
    private dbPath: string = DEFAULT_DB_PATH,
  ) {}

  async tick(sink: Sink): Promise<TickResult> {
    if (!fs.existsSync(this.dbPath)) {
      return {
        eventsEmitted: 0,
        sourceStatus: "off",
        detail: "no opencode.db found",
      };
    }

    let db: Database;
    try {
      db = new Database(this.dbPath, { readonly: true });
    } catch (err) {
      return {
        eventsEmitted: 0,
        sourceStatus: "error",
        detail: `failed to open opencode.db: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    try {
      const sessionCount = (
        db.query(`SELECT COUNT(*) AS c FROM session`).get() as { c: number }
      ).c;
      if (sessionCount === 0) {
        return {
          eventsEmitted: 0,
          sourceStatus: "off",
          detail: "no sessions in opencode.db",
        };
      }

      const cursor = normalizeCursor(this.state.getAggregate(CURSOR_KEY));
      const events: IngestEvent[] = [];
      const nextCursor: OpenCodeDbCursor = {
        session: { ...cursor.session },
        message: { ...cursor.message },
        part: { ...cursor.part },
      };

      // Compound watermark: (time_updated, id) so LIMIT batches never skip
      // rows that share the boundary timestamp.
      const parts = db
        .query(
          `SELECT id, message_id, session_id, time_created, time_updated, data
           FROM part
           WHERE json_extract(data, '$.type') = 'tool'
             AND (
               time_updated > ?
               OR (time_updated = ? AND id > ?)
             )
           ORDER BY time_updated ASC, id ASC
           LIMIT ?`,
        )
        .all(
          cursor.part.updated,
          cursor.part.updated,
          cursor.part.id,
          MAX_PARTS_PER_TICK,
        ) as OpenCodePartRow[];

      for (const part of parts) {
        const event = parseToolPart(part);
        if (event) events.push(event);
        nextCursor.part = advanceTableCursor(
          nextCursor.part,
          part.time_updated,
          part.id,
        );
      }

      const messages = db
        .query(
          `SELECT id, session_id, time_created, time_updated, data
           FROM message
           WHERE time_updated > ?
              OR (time_updated = ? AND id > ?)
           ORDER BY time_updated ASC, id ASC
           LIMIT ?`,
        )
        .all(
          cursor.message.updated,
          cursor.message.updated,
          cursor.message.id,
          MAX_MESSAGES_PER_TICK,
        ) as OpenCodeMessageRow[];

      for (const message of messages) {
        let userText: string | undefined;
        try {
          const role = (
            JSON.parse(message.data) as { role?: string }
          ).role?.toLowerCase();
          if (role === "user") {
            const textParts = db
              .query(
                `SELECT data FROM part
                 WHERE message_id = ?
                   AND json_extract(data, '$.type') = 'text'
                 ORDER BY time_created ASC
                 LIMIT 3`,
              )
              .all(message.id) as Array<{ data: string }>;
            userText = textParts
              .map((p) => textFromPartData(p.data))
              .filter(Boolean)
              .join("\n")
              .slice(0, 500);
          }
        } catch {
          // fall through without user text
        }

        const event = parseMessage(message, userText);
        if (event) events.push(event);
        nextCursor.message = advanceTableCursor(
          nextCursor.message,
          message.time_updated,
          message.id,
        );
      }

      const sessions = db
        .query(
          `SELECT id, directory, title, version, agent, model, cost,
                  tokens_input, tokens_output, tokens_reasoning,
                  tokens_cache_read, tokens_cache_write,
                  time_created, time_updated, time_archived
           FROM session
           WHERE time_updated > ?
              OR (time_updated = ? AND id > ?)
           ORDER BY time_updated ASC, id ASC
           LIMIT ?`,
        )
        .all(
          cursor.session.updated,
          cursor.session.updated,
          cursor.session.id,
          MAX_SESSIONS_PER_TICK,
        ) as OpenCodeSessionRow[];

      // Also re-emit sessions touched by new activity even if session.time_updated
      // did not advance (defensive — OpenCode usually bumps it).
      const touchedSessionIds = new Set<string>([
        ...parts.map((p) => p.session_id),
        ...messages.map((m) => m.session_id),
        ...sessions.map((s) => s.id),
      ]);

      for (const sessionId of touchedSessionIds) {
        const row =
          sessions.find((s) => s.id === sessionId) ??
          (db
            .query(
              `SELECT id, directory, title, version, agent, model, cost,
                      tokens_input, tokens_output, tokens_reasoning,
                      tokens_cache_read, tokens_cache_write,
                      time_created, time_updated, time_archived
               FROM session WHERE id = ?`,
            )
            .get(sessionId) as OpenCodeSessionRow | null);
        if (!row) continue;

        const counts = this.loadCounts(db, sessionId);
        events.push(sessionToIngestEvent(row, counts));
        nextCursor.session = advanceTableCursor(
          nextCursor.session,
          row.time_updated,
          row.id,
        );
      }

      if (events.length === 0) {
        if (
          parts.length === 0 &&
          messages.length === 0 &&
          sessions.length === 0
        ) {
          return { eventsEmitted: 0, sourceStatus: "ok" };
        }
      }

      if (events.length > 0) {
        await sendBatched(
          sink,
          SOURCE_ID,
          INSTANCE_ID,
          COLLECTOR_VERSION,
          events,
        );
      }

      this.state.setAggregate(CURSOR_KEY, nextCursor);
      this.state.persist();

      return { eventsEmitted: events.length, sourceStatus: "ok" };
    } finally {
      db.close();
    }
  }

  private loadCounts(db: Database, sessionId: string): OpenCodeSessionCounts {
    const turnCount = (
      db
        .query(
          `SELECT COUNT(*) AS c FROM message
           WHERE session_id = ?
             AND json_extract(data, '$.role') = 'user'`,
        )
        .get(sessionId) as { c: number }
    ).c;

    const toolCallCount = (
      db
        .query(
          `SELECT COUNT(*) AS c FROM part
           WHERE session_id = ?
             AND json_extract(data, '$.type') = 'tool'`,
        )
        .get(sessionId) as { c: number }
    ).c;

    const failureCount = (
      db
        .query(
          `SELECT COUNT(*) AS c FROM part
           WHERE session_id = ?
             AND json_extract(data, '$.type') = 'tool'
             AND json_extract(data, '$.state.status') = 'error'`,
        )
        .get(sessionId) as { c: number }
    ).c;

    return { turnCount, toolCallCount, failureCount };
  }
}
