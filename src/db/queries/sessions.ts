import type { Database as SqliteDatabase } from "sqlite";
import type { SessionPayload } from "../../types/ingest.js";
import type { SessionSummary } from "../../types/activity.js";

export interface SessionRow {
  id: string;
  source_id: string;
  instance_id: string;
  external_id: string;
  cwd: string | null;
  git_branch: string | null;
  title: string | null;
  client_version: string | null;
  model_provider: string | null;
  started_at: string;
  ended_at: string | null;
  turn_count: number;
  tool_call_count: number;
  failure_count: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cost_usd: number | null;
}

export function sessionId(sourceId: string, externalId: string): string {
  return `${sourceId}:${externalId}`;
}

export async function upsertSession(
  db: SqliteDatabase,
  sourceId: string,
  instanceId: string,
  payload: SessionPayload,
): Promise<string> {
  const id = sessionId(sourceId, payload.externalId);
  await db.run(
    `INSERT INTO sessions (
       id, source_id, instance_id, external_id, cwd, git_branch, title,
       client_version, model_provider, started_at, ended_at, turn_count,
       tool_call_count, failure_count, input_tokens, output_tokens,
       cache_read_tokens, cache_write_tokens, cost_usd, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(source_id, external_id) DO UPDATE SET
       instance_id = excluded.instance_id,
       cwd = COALESCE(excluded.cwd, sessions.cwd),
       git_branch = COALESCE(excluded.git_branch, sessions.git_branch),
       title = COALESCE(excluded.title, sessions.title),
       client_version = COALESCE(excluded.client_version, sessions.client_version),
       model_provider = COALESCE(excluded.model_provider, sessions.model_provider),
       ended_at = COALESCE(excluded.ended_at, sessions.ended_at),
       turn_count = MAX(sessions.turn_count, excluded.turn_count),
       tool_call_count = MAX(sessions.tool_call_count, excluded.tool_call_count),
       failure_count = MAX(sessions.failure_count, excluded.failure_count),
       input_tokens = MAX(sessions.input_tokens, excluded.input_tokens),
       output_tokens = MAX(sessions.output_tokens, excluded.output_tokens),
       cache_read_tokens = MAX(sessions.cache_read_tokens, excluded.cache_read_tokens),
       cache_write_tokens = MAX(sessions.cache_write_tokens, excluded.cache_write_tokens),
       cost_usd = COALESCE(excluded.cost_usd, sessions.cost_usd),
       updated_at = CURRENT_TIMESTAMP`,
    id,
    sourceId,
    instanceId,
    payload.externalId,
    payload.cwd ?? null,
    payload.gitBranch ?? null,
    payload.title ?? null,
    payload.clientVersion ?? null,
    payload.modelProvider ?? null,
    payload.startedAt,
    payload.endedAt ?? null,
    payload.turnCount ?? 0,
    payload.toolCallCount ?? 0,
    payload.failureCount ?? 0,
    payload.inputTokens ?? 0,
    payload.outputTokens ?? 0,
    payload.cacheReadTokens ?? 0,
    payload.cacheWriteTokens ?? 0,
    payload.costUsd ?? null,
  );
  return id;
}

/** Ensures a session row exists for an activity that arrived before its session event. */
export async function ensureSessionPlaceholder(
  db: SqliteDatabase,
  sourceId: string,
  instanceId: string,
  externalId: string,
  startedAt: string,
): Promise<string> {
  const id = sessionId(sourceId, externalId);
  await db.run(
    `INSERT INTO sessions (id, source_id, instance_id, external_id, started_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(source_id, external_id) DO NOTHING`,
    id,
    sourceId,
    instanceId,
    externalId,
    startedAt,
  );
  return id;
}

/**
 * Bumps ended_at for real-time "still active" freshness between session-event
 * re-observations. Does NOT touch turn_count/tool_call_count/failure_count/
 * token sums — those are authoritative from upsertSession's MAX-merge across
 * session events (the collector re-observes and resends the session's own
 * cumulative counts on every scan tick, since Claude Code/Codex session
 * files are mutable and grow in place). Additively incrementing counters
 * here too would double-count every field the session event already merges.
 */
export async function touchSessionActivity(
  db: SqliteDatabase,
  sessionRowId: string,
  timestamp: string,
): Promise<void> {
  await db.run(
    `UPDATE sessions SET
       ended_at = CASE WHEN ended_at IS NULL OR ended_at < ? THEN ? ELSE ended_at END,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    timestamp,
    timestamp,
    sessionRowId,
  );
}

export async function listSessions(
  db: SqliteDatabase,
  opts: { sourceId?: string; limit?: number; offset?: number } = {},
): Promise<SessionRow[]> {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  if (opts.sourceId) {
    return db.all<SessionRow[]>(
      `SELECT * FROM sessions WHERE source_id = ? ORDER BY started_at DESC LIMIT ? OFFSET ?`,
      opts.sourceId,
      limit,
      offset,
    );
  }
  return db.all<SessionRow[]>(
    `SELECT * FROM sessions ORDER BY started_at DESC LIMIT ? OFFSET ?`,
    limit,
    offset,
  );
}

export async function getSessionRow(
  db: SqliteDatabase,
  id: string,
): Promise<SessionRow | undefined> {
  return db.get<SessionRow>(`SELECT * FROM sessions WHERE id = ?`, id);
}

export function rowToSessionSummary(
  row: SessionRow,
): Omit<SessionSummary, "activities"> {
  return {
    sessionId: row.id,
    sourceId: row.source_id,
    instanceId: row.instance_id,
    externalId: row.external_id,
    cwd: row.cwd ?? undefined,
    gitBranch: row.git_branch ?? undefined,
    title: row.title ?? undefined,
    startTime: row.started_at,
    endTime: row.ended_at ?? undefined,
    stats: {
      turnCount: row.turn_count,
      toolCallCount: row.tool_call_count,
      failureCount: row.failure_count,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      cacheReadTokens: row.cache_read_tokens,
      cacheWriteTokens: row.cache_write_tokens,
      costUsd: row.cost_usd ?? undefined,
    },
  };
}
