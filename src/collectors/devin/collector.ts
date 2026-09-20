/**
 * Devin CLI desktop collector — reads ~/.local/share/devin/cli/sessions.db
 * incrementally and emits session + activity ingest events.
 *
 * Uses bun:sqlite in readonly mode so we never contend with Devin's WAL
 * writer. Cursor state lives in CollectorStateStore aggregates (this source
 * is SQLite, not JSONL — same pattern as the OpenCode collector).
 *
 * Plan-capacity quota snapshots come from usage-poller.ts, which calls the
 * same SeatManagementService/GetUserStatus endpoint the CLI itself uses.
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
  advanceSessionCursor,
  normalizeCursor,
  parseMessageNode,
  sessionMetadataToIngestEvent,
  sessionToIngestEvent,
  type DevinDbCursor,
  type DevinMessageNodeRow,
  type DevinSessionCounts,
  type DevinSessionRow,
} from "./parser.js";
import {
  DEFAULT_DEVIN_CREDENTIALS_PATH,
  DEVIN_USAGE_POLL_INTERVAL_MS,
  pollDevinUsageEvents,
} from "./usage-poller.js";

const SOURCE_ID = "devin";
const COLLECTOR_VERSION = "0.1.0";
const DEFAULT_DB_PATH = path.join(
  os.homedir(),
  ".local",
  "share",
  "devin",
  "cli",
  "sessions.db",
);
const CURSOR_KEY = `${SOURCE_ID}:db-cursor`;
/** Cap rows per tick so a first-run backfill does not monopolize the sink. */
const MAX_MESSAGES_PER_TICK = 1_000;
const MAX_SESSIONS_PER_TICK = 200;

interface StateStore {
  getAggregate: CollectorStateStore["getAggregate"];
  setAggregate: CollectorStateStore["setAggregate"];
  persist: CollectorStateStore["persist"];
}

export class DevinCollector implements Collector {
  sourceId = SOURCE_ID;
  instanceId = `${SOURCE_ID}@${os.hostname()}`;
  intervalMs = 30_000;

  /** Last successful-or-attempted plan-usage poll (ms epoch). */
  private lastUsagePollMs = 0;

  constructor(
    private state: StateStore,
    private dbPath: string = DEFAULT_DB_PATH,
    private credentialsPath: string = DEFAULT_DEVIN_CREDENTIALS_PATH,
  ) {}

  async tick(sink: Sink): Promise<TickResult> {
    if (!fs.existsSync(this.dbPath)) {
      // Plan quota is account-level — a machine can report it from
      // credentials.toml even when Devin CLI has never run a session here.
      return this.usageOnlyTick(sink, "no sessions.db found");
    }

    let db: Database;
    try {
      db = new Database(this.dbPath, { readonly: true });
    } catch (err) {
      return {
        eventsEmitted: 0,
        sourceStatus: "error",
        detail: `failed to open sessions.db: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    try {
      const sessionCount = (
        db.query(`SELECT COUNT(*) AS c FROM sessions`).get() as { c: number }
      ).c;
      if (sessionCount === 0) {
        return await this.usageOnlyTick(sink, "no sessions in sessions.db");
      }

      const cursor = normalizeCursor(this.state.getAggregate(CURSOR_KEY));
      const events: IngestEvent[] = [];
      const nextCursor: DevinDbCursor = {
        session: { ...cursor.session },
        messageRowId: cursor.messageRowId,
      };

      const messages = db
        .query(
          `SELECT row_id, session_id, node_id, parent_node_id, chat_message, created_at
           FROM message_nodes
           WHERE row_id > ?
             AND json_extract(chat_message, '$.role') IN ('user', 'assistant', 'tool')
           ORDER BY row_id ASC
           LIMIT ?`,
        )
        .all(cursor.messageRowId, MAX_MESSAGES_PER_TICK) as
        | DevinMessageNodeRow[]
        | [];

      for (const message of messages) {
        const event = parseMessageNode(message);
        if (event) events.push(event);
        if (message.row_id > nextCursor.messageRowId) {
          nextCursor.messageRowId = message.row_id;
        }
      }
      // When the scan did not hit the row cap, nothing unscanned remains —
      // advance past rows the role filter excluded (e.g. `system` nodes) so
      // they are not re-queried on every tick.
      if (messages.length < MAX_MESSAGES_PER_TICK) {
        const maxRowId = (
          db.query(`SELECT MAX(row_id) AS m FROM message_nodes`).get() as {
            m: number | null;
          }
        ).m;
        if (maxRowId != null && maxRowId > nextCursor.messageRowId) {
          nextCursor.messageRowId = maxRowId;
        }
      }

      // Compound watermark: (last_activity_at, id) so LIMIT batches never
      // skip rows that share the boundary timestamp.
      const sessions = db
        .query(
          `SELECT id, working_directory, backend_type, model, agent_mode,
                  created_at, last_activity_at, title, hidden, metadata
           FROM sessions
           WHERE hidden = 0
             AND (
               last_activity_at > ?
               OR (last_activity_at = ? AND id > ?)
             )
           ORDER BY last_activity_at ASC, id ASC
           LIMIT ?`,
        )
        .all(
          cursor.session.activity,
          cursor.session.activity,
          cursor.session.id,
          MAX_SESSIONS_PER_TICK,
        ) as DevinSessionRow[] | [];

      // Re-emit sessions touched by new activity even when the session row's
      // last_activity_at did not advance past the cursor.
      const touchedSessionIds = new Set<string>([
        ...messages.map((m) => m.session_id),
        ...sessions.map((s) => s.id),
      ]);

      // Batch-fetch session rows not already returned by the window query
      // (messages may touch sessions whose watermark did not advance).
      const sessionRows = new Map<string, DevinSessionRow>(
        sessions.map((s) => [s.id, s]),
      );
      const missingIds = [...touchedSessionIds].filter(
        (id) => !sessionRows.has(id),
      );
      if (missingIds.length > 0) {
        const rows = db
          .query(
            `SELECT id, working_directory, backend_type, model, agent_mode,
                    created_at, last_activity_at, title, hidden, metadata
             FROM sessions WHERE id IN (${missingIds.map(() => "?").join(",")})`,
          )
          .all(...missingIds) as DevinSessionRow[];
        for (const row of rows) sessionRows.set(row.id, row);
      }

      for (const sessionId of touchedSessionIds) {
        const row = sessionRows.get(sessionId);
        if (!row || row.hidden) continue;

        const counts = this.loadCounts(db, sessionId);
        events.push(sessionToIngestEvent(row, counts));
        const metaEvent = sessionMetadataToIngestEvent(row);
        if (metaEvent) events.push(metaEvent);
        nextCursor.session = advanceSessionCursor(
          nextCursor.session,
          row.last_activity_at,
          row.id,
        );
      }

      // Plan-usage poll (every 15 min). Can emit events even when no session
      // rows changed — do not early-return solely on an empty scan.
      events.push(...(await this.maybePollUsage()));

      if (events.length > 0) {
        await sendBatched(
          sink,
          SOURCE_ID,
          this.instanceId,
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

  /** Interval-gated plan-usage poll shared by the normal and db-less paths. */
  private async maybePollUsage(): Promise<IngestEvent[]> {
    const nowMs = Date.now();
    if (nowMs - this.lastUsagePollMs < DEVIN_USAGE_POLL_INTERVAL_MS) {
      return [];
    }
    this.lastUsagePollMs = nowMs;
    return pollDevinUsageEvents({
      credentialsPath: this.credentialsPath,
      onWarn: (m) => console.warn(`[devin] ${m}`),
    });
  }

  /**
   * No session data on this machine — still try the quota poll. Emits and
   * reports "ok" when quota events flow; otherwise "off" with the reason.
   */
  private async usageOnlyTick(sink: Sink, detail: string): Promise<TickResult> {
    const quotaEvents = await this.maybePollUsage();
    if (quotaEvents.length === 0) {
      return { eventsEmitted: 0, sourceStatus: "off", detail };
    }
    await sendBatched(
      sink,
      SOURCE_ID,
      this.instanceId,
      COLLECTOR_VERSION,
      quotaEvents,
    );
    return { eventsEmitted: quotaEvents.length, sourceStatus: "ok" };
  }

  private loadCounts(db: Database, sessionId: string): DevinSessionCounts {
    const turnCount = (
      db
        .query(
          `SELECT COUNT(*) AS c FROM message_nodes
           WHERE session_id = ?
             AND json_extract(chat_message, '$.role') = 'user'`,
        )
        .get(sessionId) as { c: number }
    ).c;

    const toolCallCount = (
      db
        .query(`SELECT COUNT(*) AS c FROM tool_call_state WHERE session_id = ?`)
        .get(sessionId) as { c: number }
    ).c;

    const failureCount = (
      db
        .query(
          `SELECT COUNT(*) AS c FROM message_nodes
           WHERE session_id = ?
             AND json_extract(chat_message, '$.role') = 'tool'
             AND json_extract(
                   chat_message,
                   '$.metadata.extensions."chisel/tool_result_meta".success'
                 ) = 0`,
        )
        .get(sessionId) as { c: number }
    ).c;

    return { turnCount, toolCallCount, failureCount };
  }
}
