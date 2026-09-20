/**
 * Cursor desktop collector — reads Cursor's local SQLite stores
 * incrementally and emits session + activity ingest events.
 *
 * Two stacks (see parser.ts header for the schema notes):
 *  - IDE chats: `~/.config/Cursor/User/globalStorage/state.vscdb`
 *    (`cursorDiskKV` table; macOS falls back to `~/Library/Application
 *    Support/Cursor/User/globalStorage/state.vscdb`).
 *  - cursor-agent CLI: `~/.cursor/chats/<md5(workspace)>/<uuid>/store.db`
 *    plus a sibling `meta.json` (`CURSOR_CONFIG_DIR` overrides `~/.cursor`).
 *
 * All DBs are opened readonly via bun:sqlite so we never contend with
 * Cursor's own WAL writer. Incremental state lives in CollectorStateStore
 * aggregates: a cursorDiskKV rowid watermark + per-composer lastUpdatedAt
 * (composerData rows are updated in place, so they are re-scanned each
 * tick — that keyspace is bounded), and a per-store.db blobs rowid
 * watermark + emitted meta.updatedAtMs.
 */

import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { Database } from "bun:sqlite";
import type { Collector, TickResult } from "../core/types.js";
import type { IngestEvent, Sink } from "../../types/ingest.js";
import { CollectorStateStore } from "../core/state-store.js";
import { sendBatched } from "../core/scheduler.js";
import {
  chatMetaToIngestEvent,
  classifyKvKey,
  composerToIngestEvent,
  decodeKvValue,
  parseBubble,
  parseChatMetaJson,
  parseComposerData,
  parseStoreBlob,
  parseToolFormerData,
  type CursorBlobRow,
  type CursorKvRow,
  type CursorSessionCounts,
} from "./parser.js";

const SOURCE_ID = "cursor";
const COLLECTOR_VERSION = "0.1.0";
const CURSOR_KEY = `${SOURCE_ID}:db-cursor`;
/** Cap rows per tick so a first-run backfill does not monopolize the sink. */
const MAX_KV_ROWS_PER_TICK = 2_000;
const MAX_COMPOSERS_PER_TICK = 5_000;
const MAX_BLOBS_PER_TICK = 2_000;

interface ComposerAggregate extends CursorSessionCounts {
  lastUpdatedAt: number;
}

interface ChatStoreAggregate extends CursorSessionCounts {
  rowid: number;
  updatedAtMs: number;
}

interface CursorCollectorState {
  kvRowid: number;
  composers: Record<string, ComposerAggregate>;
  chatStores: Record<string, ChatStoreAggregate>;
}

interface StateStore {
  getAggregate: CollectorStateStore["getAggregate"];
  setAggregate: CollectorStateStore["setAggregate"];
  persist: CollectorStateStore["persist"];
}

export interface CursorCollectorPaths {
  globalDbPath?: string;
  chatsDir?: string;
  workspaceStorageDir?: string;
}

function cursorConfigDir(): string {
  return process.env.CURSOR_CONFIG_DIR || path.join(os.homedir(), ".cursor");
}

function defaultGlobalDbPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  const candidates = [
    path.join(xdg, "Cursor", "User", "globalStorage", "state.vscdb"),
    path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "Cursor",
      "User",
      "globalStorage",
      "state.vscdb",
    ),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? candidates[0]!;
}

function defaultWorkspaceStorageDir(globalDbPath: string): string {
  // <Cursor>/User/globalStorage/state.vscdb → <Cursor>/User/workspaceStorage
  return path.join(
    path.dirname(path.dirname(globalDbPath)),
    "workspaceStorage",
  );
}

function emptyState(): CursorCollectorState {
  return { kvRowid: 0, composers: {}, chatStores: {} };
}

function normalizeState(raw: unknown): CursorCollectorState {
  if (!raw || typeof raw !== "object") return emptyState();
  const r = raw as Partial<CursorCollectorState>;
  // Deep-copy the nested aggregates: a failed send must not leave mutated
  // counts in the store's in-memory objects (rows get re-scanned and
  // double-counted when kvRowid/rowid stayed behind).
  const copy = <T extends object>(rec: unknown): Record<string, T> =>
    rec && typeof rec === "object"
      ? Object.fromEntries(
          Object.entries(rec as Record<string, T>).map(([k, v]) => [
            k,
            { ...v },
          ]),
        )
      : {};
  return {
    kvRowid: typeof r.kvRowid === "number" ? r.kvRowid : 0,
    composers: copy<ComposerAggregate>(r.composers),
    chatStores: copy<ChatStoreAggregate>(r.chatStores),
  };
}

function bump(
  counts: CursorSessionCounts,
  kind: "turn" | "tool" | "failure",
): void {
  if (kind === "turn") counts.turnCount++;
  else if (kind === "tool") counts.toolCallCount++;
  else counts.failureCount++;
}

function tableExists(db: Database, name: string): boolean {
  const row = db
    .query(
      `SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name=?`,
    )
    .get(name) as { c: number };
  return row.c > 0;
}

export class CursorCollector implements Collector {
  sourceId = SOURCE_ID;
  instanceId = `${SOURCE_ID}@${os.hostname()}`;
  intervalMs = 30_000;

  private globalDbPath: string;
  private chatsDir: string;
  private workspaceStorageDir: string;

  constructor(
    private state: StateStore,
    paths: CursorCollectorPaths = {},
  ) {
    this.globalDbPath = paths.globalDbPath ?? defaultGlobalDbPath();
    this.chatsDir = paths.chatsDir ?? path.join(cursorConfigDir(), "chats");
    this.workspaceStorageDir =
      paths.workspaceStorageDir ??
      defaultWorkspaceStorageDir(this.globalDbPath);
  }

  async tick(sink: Sink): Promise<TickResult> {
    const hasGlobalDb = fs.existsSync(this.globalDbPath);
    const hasChatsDir = fs.existsSync(this.chatsDir);
    if (!hasGlobalDb && !hasChatsDir) {
      return {
        eventsEmitted: 0,
        sourceStatus: "off",
        detail: "no Cursor data found (state.vscdb or ~/.cursor/chats)",
      };
    }

    const state = normalizeState(this.state.getAggregate(CURSOR_KEY));
    const events: IngestEvent[] = [];
    let sawSessions = false;

    if (hasGlobalDb) {
      const result = this.scanGlobalDb(state, events);
      if (result.error) {
        return {
          eventsEmitted: 0,
          sourceStatus: "error",
          detail: result.error,
        };
      }
      sawSessions ||= result.sawSessions;
    }

    if (hasChatsDir) {
      const result = this.scanChatStores(state, events);
      if (result.error) {
        return {
          eventsEmitted: 0,
          sourceStatus: "error",
          detail: result.error,
        };
      }
      sawSessions ||= result.sawSessions;
    }

    if (!sawSessions) {
      return {
        eventsEmitted: 0,
        sourceStatus: "off",
        detail: "no Cursor sessions found",
      };
    }

    if (events.length > 0) {
      await sendBatched(
        sink,
        SOURCE_ID,
        this.instanceId,
        COLLECTOR_VERSION,
        events,
      );
    }

    this.state.setAggregate(CURSOR_KEY, state);
    this.state.persist();

    return { eventsEmitted: events.length, sourceStatus: "ok" };
  }

  /**
   * state.vscdb cursorDiskKV. Composer headers are re-scanned every tick
   * (bounded keyspace, updated in place); bubbles/tool rows stream via the
   * rowid watermark.
   */
  private scanGlobalDb(
    state: CursorCollectorState,
    events: IngestEvent[],
  ): { sawSessions: boolean; error?: string } {
    let db: Database;
    try {
      db = new Database(this.globalDbPath, { readonly: true });
    } catch (err) {
      return {
        sawSessions: false,
        error: `failed to open state.vscdb: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    try {
      if (!tableExists(db, "cursorDiskKV")) return { sawSessions: false };

      // Bubbles + tool rows first so session counts include this tick's rows.
      const kvRows = db
        .query(
          `SELECT rowid, key, value FROM cursorDiskKV
           WHERE rowid > ?
             AND (key GLOB 'bubbleId:*' OR key GLOB 'toolFormerData:*')
           ORDER BY rowid ASC
           LIMIT ?`,
        )
        .all(state.kvRowid, MAX_KV_ROWS_PER_TICK) as CursorKvRow[];

      for (const row of kvRows) {
        state.kvRowid = Math.max(state.kvRowid, row.rowid);
        const value = decodeKvValue(row.value);
        if (value === null) continue;
        const kind = classifyKvKey(row.key);

        if (kind === "bubble") {
          const parsed = parseBubble(row.key, value);
          if (!parsed) continue;
          events.push(parsed.event);
          const agg = this.composerAgg(state, parsed.composerId);
          const p = parsed.event.payload as {
            actionType?: string;
            status?: string;
          };
          if (p.actionType === "user_request") bump(agg, "turn");
          if (p.actionType === "tool_call") {
            bump(agg, "tool");
            if (p.status === "failure") bump(agg, "failure");
          }
        } else if (kind === "tool") {
          const event = parseToolFormerData(row.key, value);
          if (!event) continue;
          events.push(event);
          const payload = event.payload as {
            sessionExternalId: string;
            status?: string;
          };
          const agg = this.composerAgg(state, payload.sessionExternalId);
          bump(agg, "tool");
          if (payload.status === "failure") bump(agg, "failure");
        }
      }

      // Composer headers: re-scan the (bounded) keyspace each tick and emit
      // when lastUpdatedAt advanced — UPDATE-in-place doesn't move rowid.
      const composerRows = db
        .query(
          `SELECT key, value FROM cursorDiskKV
           WHERE key GLOB 'composerData:*'
           ORDER BY key ASC
           LIMIT ?`,
        )
        .all(MAX_COMPOSERS_PER_TICK) as Array<{
        key: string;
        value: string | Uint8Array;
      }>;

      for (const row of composerRows) {
        const composer = parseComposerData(row.key, decodeKvValue(row.value));
        if (!composer) continue;
        const agg = this.composerAgg(state, composer.composerId);
        const updated = composer.lastUpdatedAt ?? composer.createdAt ?? 0;
        if (updated > agg.lastUpdatedAt) {
          events.push(composerToIngestEvent(composer, agg));
          agg.lastUpdatedAt = updated;
        }
      }

      return { sawSessions: composerRows.length > 0 };
    } catch (err) {
      return {
        sawSessions: false,
        error: `failed to scan state.vscdb: ${err instanceof Error ? err.message : String(err)}`,
      };
    } finally {
      db.close();
    }
  }

  /** `~/.cursor/chats/<md5>/<uuid>/store.db` + sibling meta.json. */
  private scanChatStores(
    state: CursorCollectorState,
    events: IngestEvent[],
  ): { sawSessions: boolean; error?: string } {
    const workspaceByMd5 = this.loadWorkspaceMd5Map();
    let sawSessions = false;

    let buckets: string[];
    try {
      buckets = fs.readdirSync(this.chatsDir);
    } catch {
      return { sawSessions: false };
    }

    for (const bucket of buckets) {
      const bucketDir = path.join(this.chatsDir, bucket);
      let sessionDirs: string[];
      try {
        if (!fs.statSync(bucketDir).isDirectory()) continue;
        sessionDirs = fs.readdirSync(bucketDir);
      } catch {
        continue;
      }

      for (const sessionId of sessionDirs) {
        const sessionDir = path.join(bucketDir, sessionId);
        const storePath = path.join(sessionDir, "store.db");
        if (!fs.existsSync(storePath)) continue;

        const meta = this.readChatMeta(sessionDir);
        const agg =
          state.chatStores[storePath] ??
          (state.chatStores[storePath] = {
            rowid: 0,
            updatedAtMs: 0,
            turnCount: 0,
            toolCallCount: 0,
            failureCount: 0,
          });

        let db: Database;
        try {
          db = new Database(storePath, { readonly: true });
        } catch {
          // A single broken store.db shouldn't poison the tick — skip it.
          continue;
        }

        try {
          if (!tableExists(db, "blobs")) continue;

          const blobs = db
            .query(
              `SELECT rowid, id, data FROM blobs
               WHERE rowid > ? ORDER BY rowid ASC LIMIT ?`,
            )
            .all(agg.rowid, MAX_BLOBS_PER_TICK) as CursorBlobRow[];

          let parsedBlobs = 0;
          for (const blob of blobs) {
            agg.rowid = Math.max(agg.rowid, blob.rowid);
            const event = parseStoreBlob(sessionId, blob);
            if (!event) continue;
            events.push(event);
            parsedBlobs++;
            const p = event.payload as {
              actionType?: string;
              status?: string;
            };
            if (p.actionType === "user_request") bump(agg, "turn");
            if (p.actionType === "tool_call") {
              bump(agg, "tool");
              if (p.status === "failure") bump(agg, "failure");
            }
          }

          const updated = meta?.updatedAtMs ?? meta?.createdAtMs ?? 0;
          if (updated > agg.updatedAtMs) {
            events.push(
              chatMetaToIngestEvent(
                sessionId,
                meta ?? {},
                agg,
                workspaceByMd5.get(bucket),
              ),
            );
            agg.updatedAtMs = updated;
          }

          // Only count the store as a real session when it carries a meta
          // record, produced a parseable blob, or already emitted a session
          // on an earlier tick — a bare blobs table with nothing readable
          // shouldn't flip the source to "ok" forever.
          if (meta || parsedBlobs > 0 || agg.updatedAtMs > 0) {
            sawSessions = true;
          }
        } finally {
          db.close();
        }
      }
    }

    return { sawSessions };
  }

  private readChatMeta(sessionDir: string) {
    try {
      const raw = fs.readFileSync(path.join(sessionDir, "meta.json"), "utf-8");
      return parseChatMetaJson(raw);
    } catch {
      return null;
    }
  }

  /**
   * chats bucket names are the lowercase hex MD5 of the absolute workspace
   * path; workspaceStorage/<id>/workspace.json carries the real folder URI.
   * Best-effort md5 match to recover cwd — never fatal.
   */
  private loadWorkspaceMd5Map(): Map<string, string> {
    const map = new Map<string, string>();
    let entries: string[];
    try {
      entries = fs.readdirSync(this.workspaceStorageDir);
    } catch {
      return map;
    }
    for (const entry of entries) {
      try {
        const raw = fs.readFileSync(
          path.join(this.workspaceStorageDir, entry, "workspace.json"),
          "utf-8",
        );
        const parsed = JSON.parse(raw) as { folder?: string };
        if (!parsed.folder) continue;
        const folder = parsed.folder.startsWith("file://")
          ? decodeURIComponent(parsed.folder.slice("file://".length))
          : parsed.folder;
        const md5 = (s: string) =>
          crypto.createHash("md5").update(s).digest("hex");
        map.set(md5(folder), folder);
        map.set(md5(parsed.folder), folder);
      } catch {
        // skip malformed workspace.json
      }
    }
    return map;
  }

  private composerAgg(
    state: CursorCollectorState,
    composerId: string,
  ): ComposerAggregate {
    return (
      state.composers[composerId] ??
      (state.composers[composerId] = {
        lastUpdatedAt: 0,
        turnCount: 0,
        toolCallCount: 0,
        failureCount: 0,
      })
    );
  }
}
