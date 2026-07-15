import type { Database as SqliteDatabase } from "sqlite";
import { v7 as uuidv7 } from "uuid";
import type {
  InferenceRequestPayload,
  RuntimeSnapshotPayload,
  RuntimeEventPayload,
  QuotaSnapshotPayload,
} from "../../types/ingest.js";

export async function insertInferenceRequest(
  db: SqliteDatabase,
  sourceId: string,
  instanceId: string,
  payload: InferenceRequestPayload,
): Promise<string> {
  const id = uuidv7();
  await db.run(
    `INSERT INTO inference_requests (
       id, source_id, instance_id, external_id, timestamp, model, endpoint,
       client_label, workload, prompt_tokens, completion_tokens, cached_tokens,
       ttft_ms, duration_ms, tokens_per_sec, slot_id, status, error, details
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    sourceId,
    instanceId,
    payload.externalId ?? null,
    payload.timestamp,
    payload.model ?? null,
    payload.endpoint ?? null,
    payload.clientLabel ?? null,
    payload.workload ?? "unknown",
    payload.promptTokens ?? null,
    payload.completionTokens ?? null,
    payload.cachedTokens ?? null,
    payload.ttftMs ?? null,
    payload.durationMs ?? null,
    payload.tokensPerSec ?? null,
    payload.slotId ?? null,
    payload.status,
    payload.error ?? null,
    payload.details != null ? JSON.stringify(payload.details) : null,
  );
  return id;
}

export async function insertRuntimeSnapshot(
  db: SqliteDatabase,
  sourceId: string,
  instanceId: string,
  payload: RuntimeSnapshotPayload,
): Promise<void> {
  await db.run(
    `INSERT INTO runtime_snapshots (
       source_id, instance_id, timestamp, kind, slots_total, slots_busy,
       models_loaded, healthy, payload
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    sourceId,
    instanceId,
    payload.timestamp,
    payload.kind,
    payload.slotsTotal ?? null,
    payload.slotsBusy ?? null,
    payload.modelsLoaded != null ? JSON.stringify(payload.modelsLoaded) : null,
    payload.healthy == null ? null : payload.healthy ? 1 : 0,
    payload.payload != null ? JSON.stringify(payload.payload) : null,
  );
}

export async function insertRuntimeEvent(
  db: SqliteDatabase,
  sourceId: string,
  instanceId: string,
  payload: RuntimeEventPayload,
): Promise<string> {
  const id = uuidv7();
  await db.run(
    `INSERT INTO runtime_events (
       id, source_id, instance_id, timestamp, ended_at, kind, severity, summary, details
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    sourceId,
    instanceId,
    payload.timestamp,
    payload.endedAt ?? null,
    payload.kind,
    payload.severity ?? "info",
    payload.summary,
    payload.details != null ? JSON.stringify(payload.details) : null,
  );
  return id;
}

export async function insertQuotaSnapshot(
  db: SqliteDatabase,
  sourceId: string,
  instanceId: string,
  payload: QuotaSnapshotPayload,
): Promise<void> {
  await db.run(
    `INSERT INTO quota_snapshots (
       source_id, instance_id, timestamp, limit_id, used_percent, window_minutes, resets_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    sourceId,
    instanceId,
    payload.timestamp,
    payload.limitId,
    payload.usedPercent,
    payload.windowMinutes ?? null,
    payload.resetsAt ?? null,
  );
}

export interface QuotaSnapshotRow {
  source_id: string;
  instance_id: string;
  timestamp: string;
  limit_id: string;
  used_percent: number;
  window_minutes: number | null;
  resets_at: string | null;
}

/** Latest snapshot per (source, instance, limit_id) — for a dashboard gauge. */
export async function latestQuotaSnapshots(
  db: SqliteDatabase,
): Promise<QuotaSnapshotRow[]> {
  return db.all<QuotaSnapshotRow[]>(
    `SELECT q.* FROM quota_snapshots q
     INNER JOIN (
       SELECT source_id, instance_id, limit_id, MAX(timestamp) AS max_ts
       FROM quota_snapshots GROUP BY source_id, instance_id, limit_id
     ) latest
     ON q.source_id = latest.source_id AND q.instance_id = latest.instance_id
       AND q.limit_id = latest.limit_id AND q.timestamp = latest.max_ts`,
  );
}

export interface RuntimeEventRow {
  id: string;
  source_id: string;
  instance_id: string;
  timestamp: string;
  ended_at: string | null;
  kind: string;
  severity: string;
  summary: string;
  details: string | null;
}

export async function listRecentRuntimeEvents(
  db: SqliteDatabase,
  limit = 50,
): Promise<RuntimeEventRow[]> {
  return db.all<RuntimeEventRow[]>(
    `SELECT * FROM runtime_events ORDER BY timestamp DESC LIMIT ?`,
    limit,
  );
}

export interface InferenceRequestRow {
  id: string;
  source_id: string;
  instance_id: string;
  external_id: string | null;
  timestamp: string;
  model: string | null;
  endpoint: string | null;
  client_label: string | null;
  workload: string;
  status: string;
  error: string | null;
  details: string | null;
}

export async function listFailedInferenceRequests(
  db: SqliteDatabase,
  limit = 50,
): Promise<InferenceRequestRow[]> {
  return db.all<InferenceRequestRow[]>(
    `SELECT * FROM inference_requests WHERE status != 'success' ORDER BY timestamp DESC LIMIT ?`,
    limit,
  );
}

export interface InferenceRequestDetailRow extends InferenceRequestRow {
  prompt_tokens: number | null;
  completion_tokens: number | null;
  cached_tokens: number | null;
  ttft_ms: number | null;
  duration_ms: number | null;
  tokens_per_sec: number | null;
  slot_id: number | null;
}

/** Recent requests regardless of status — the Runtime page's activity feed. */
export async function listRecentInferenceRequests(
  db: SqliteDatabase,
  limit = 50,
): Promise<InferenceRequestDetailRow[]> {
  return db.all<InferenceRequestDetailRow[]>(
    `SELECT * FROM inference_requests ORDER BY timestamp DESC LIMIT ?`,
    limit,
  );
}

export interface RuntimeSnapshotRow {
  source_id: string;
  instance_id: string;
  timestamp: string;
  kind: string;
  slots_total: number | null;
  slots_busy: number | null;
  models_loaded: string | null;
  healthy: number | null;
  payload: string | null;
}

/** Latest snapshot per (instance, kind) — the Runtime page's "current
 *  state" cards (one per backend's slot occupancy, one for llama-swap's
 *  health/model inventory). */
export async function latestRuntimeSnapshots(
  db: SqliteDatabase,
): Promise<RuntimeSnapshotRow[]> {
  return db.all<RuntimeSnapshotRow[]>(
    `SELECT s.* FROM runtime_snapshots s
     INNER JOIN (
       SELECT instance_id, kind,
         -- distinguish per-backend slots snapshots by their JSON payload's
         -- port so 3 backends' slots rows don't collapse into 1 "latest"
         json_extract(payload, '$.port') AS port,
         MAX(timestamp) AS max_ts
       FROM runtime_snapshots GROUP BY instance_id, kind, port
     ) latest
     ON s.instance_id = latest.instance_id AND s.kind = latest.kind
       AND s.timestamp = latest.max_ts
       AND (json_extract(s.payload, '$.port') IS latest.port)`,
  );
}
