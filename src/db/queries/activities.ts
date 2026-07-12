import type { Database as SqliteDatabase } from "sqlite";
import { v7 as uuidv7 } from "uuid";
import type { ActivityPayload } from "../../types/ingest.js";
import type {
  Activity,
  ActivityFilter,
  ActorType,
  ActionType,
  ActivityStatus,
} from "../../types/activity.js";

export interface ActivityRow {
  id: string;
  source_id: string;
  instance_id: string;
  session_id: string;
  external_id: string | null;
  parent_activity_id: string | null;
  parent_external_id: string | null;
  timestamp: string;
  completed_at: string | null;
  duration_ms: number | null;
  actor_type: string;
  actor_id: string;
  actor_role: string | null;
  actor_session_label: string | null;
  action_type: string;
  tool_name: string | null;
  description: string;
  details: string | null;
  status: string;
  result: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  model: string | null;
  cost_usd: number | null;
  request_id: string | null;
  tags: string | null;
  metadata: string | null;
  created_at: string;
}

export async function insertActivity(
  db: SqliteDatabase,
  sourceId: string,
  instanceId: string,
  sessionRowId: string,
  payload: ActivityPayload,
): Promise<ActivityRow> {
  const id = uuidv7();

  let parentActivityId: string | null = null;
  if (payload.parentExternalId) {
    const parent = await db.get<{ id: string }>(
      `SELECT id FROM activities WHERE source_id = ? AND session_id = ? AND external_id = ?`,
      sourceId,
      sessionRowId,
      payload.parentExternalId,
    );
    parentActivityId = parent?.id ?? null;
  }

  const totalTokens =
    payload.totalTokens ??
    (payload.inputTokens != null || payload.outputTokens != null
      ? (payload.inputTokens ?? 0) + (payload.outputTokens ?? 0)
      : null);

  await db.run(
    `INSERT INTO activities (
       id, source_id, instance_id, session_id, external_id, parent_activity_id, parent_external_id,
       timestamp, completed_at, duration_ms, actor_type, actor_id, actor_role, actor_session_label,
       action_type, tool_name, description, details, status, result,
       input_tokens, output_tokens, total_tokens, cache_read_tokens, cache_write_tokens,
       model, cost_usd, request_id, tags, metadata
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    sourceId,
    instanceId,
    sessionRowId,
    payload.externalId ?? null,
    parentActivityId,
    payload.parentExternalId ?? null,
    payload.timestamp,
    payload.completedAt ?? null,
    payload.durationMs ?? null,
    payload.actorType,
    payload.actorId,
    payload.actorRole ?? null,
    payload.actorSessionLabel ?? null,
    payload.actionType,
    payload.toolName ?? null,
    payload.description,
    payload.details != null ? JSON.stringify(payload.details) : null,
    payload.status,
    payload.result != null ? JSON.stringify(payload.result) : null,
    payload.inputTokens ?? null,
    payload.outputTokens ?? null,
    totalTokens,
    payload.cacheReadTokens ?? null,
    payload.cacheWriteTokens ?? null,
    payload.model ?? null,
    payload.costUsd ?? null,
    payload.requestId ?? null,
    payload.tags ?? null,
    payload.metadata != null ? JSON.stringify(payload.metadata) : null,
  );

  const row = await db.get<ActivityRow>(
    `SELECT * FROM activities WHERE id = ?`,
    id,
  );
  return row!;
}

export async function listActivities(
  db: SqliteDatabase,
  filter: ActivityFilter,
): Promise<ActivityRow[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.sourceId) {
    clauses.push("source_id = ?");
    params.push(filter.sourceId);
  }
  if (filter.sessionId) {
    clauses.push("session_id = ?");
    params.push(filter.sessionId);
  }
  if (filter.actorId) {
    clauses.push("actor_id = ?");
    params.push(filter.actorId);
  }
  if (filter.actorType) {
    clauses.push("actor_type = ?");
    params.push(filter.actorType);
  }
  if (filter.actionType) {
    clauses.push("action_type = ?");
    params.push(filter.actionType);
  }
  if (filter.toolName) {
    clauses.push("tool_name = ?");
    params.push(filter.toolName);
  }
  if (filter.status) {
    clauses.push("status = ?");
    params.push(filter.status);
  }
  if (filter.startTime) {
    clauses.push("timestamp >= ?");
    params.push(filter.startTime);
  }
  if (filter.endTime) {
    clauses.push("timestamp <= ?");
    params.push(filter.endTime);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = filter.limit ?? 50;
  const offset = filter.offset ?? 0;
  params.push(limit, offset);
  return db.all<ActivityRow[]>(
    `SELECT * FROM activities ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
    ...(params as []),
  );
}

export async function getActivity(
  db: SqliteDatabase,
  id: string,
): Promise<ActivityRow | undefined> {
  return db.get<ActivityRow>(`SELECT * FROM activities WHERE id = ?`, id);
}

export async function listSessionActivities(
  db: SqliteDatabase,
  sessionRowId: string,
): Promise<ActivityRow[]> {
  return db.all<ActivityRow[]>(
    `SELECT * FROM activities WHERE session_id = ? ORDER BY timestamp ASC`,
    sessionRowId,
  );
}

export async function listFailedActivities(
  db: SqliteDatabase,
  limit = 50,
): Promise<ActivityRow[]> {
  return db.all<ActivityRow[]>(
    `SELECT * FROM activities WHERE status = 'failure' ORDER BY timestamp DESC LIMIT ?`,
    limit,
  );
}

export function rowToActivity(row: ActivityRow): Activity {
  return {
    id: row.id,
    sourceId: row.source_id,
    instanceId: row.instance_id,
    sessionId: row.session_id,
    externalId: row.external_id ?? undefined,
    parentActivityId: row.parent_activity_id ?? undefined,
    parentExternalId: row.parent_external_id ?? undefined,
    timestamp: row.timestamp,
    completedAt: row.completed_at ?? undefined,
    durationMs: row.duration_ms ?? undefined,
    actor: {
      type: row.actor_type as ActorType,
      id: row.actor_id,
      role: row.actor_role ?? undefined,
      sessionLabel: row.actor_session_label ?? undefined,
    },
    actionType: row.action_type as ActionType,
    toolName: row.tool_name ?? undefined,
    description: row.description,
    details: row.details ? JSON.parse(row.details) : undefined,
    status: row.status as ActivityStatus,
    result: row.result ? JSON.parse(row.result) : undefined,
    inputTokens: row.input_tokens ?? undefined,
    outputTokens: row.output_tokens ?? undefined,
    totalTokens: row.total_tokens ?? undefined,
    cacheReadTokens: row.cache_read_tokens ?? undefined,
    cacheWriteTokens: row.cache_write_tokens ?? undefined,
    model: row.model ?? undefined,
    costUsd: row.cost_usd ?? undefined,
    requestId: row.request_id ?? undefined,
    tags: row.tags ? row.tags.split(",") : undefined,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    createdAt: row.created_at,
  };
}
