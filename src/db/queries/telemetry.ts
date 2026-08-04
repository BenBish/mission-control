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

export interface RuntimeEventFilter {
  sourceId?: string;
  kind?: string;
  /** ISO timestamp lower bound (inclusive). */
  since?: string;
  /** ISO timestamp upper bound (inclusive). */
  until?: string;
  limit?: number;
  offset?: number;
}

export interface PaginatedResult<T> {
  rows: T[];
  total: number;
}

function buildWhereSql(clauses: string[]): string {
  if (clauses.length === 0) return "";
  return `WHERE ${clauses.join(" AND ")}`;
}

/** Cap percentile samples so metrics stay cheap on large tables / 5s polls. */
export const LATENCY_SAMPLE_LIMIT = 10_000;

export async function listRuntimeEvents(
  db: SqliteDatabase,
  filter: RuntimeEventFilter = {},
): Promise<PaginatedResult<RuntimeEventRow>> {
  const limit = filter.limit ?? 20;
  const offset = filter.offset ?? 0;
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filter.sourceId) {
    clauses.push("source_id = ?");
    params.push(filter.sourceId);
  }
  if (filter.kind) {
    clauses.push("kind = ?");
    params.push(filter.kind);
  }
  if (filter.since) {
    clauses.push("timestamp >= ?");
    params.push(filter.since);
  }
  if (filter.until) {
    clauses.push("timestamp <= ?");
    params.push(filter.until);
  }

  const where = buildWhereSql(clauses);
  const countRow = await db.get<{ c: number }>(
    `SELECT COUNT(*) AS c FROM runtime_events ${where}`,
    ...params,
  );
  const rows = await db.all<RuntimeEventRow[]>(
    `SELECT * FROM runtime_events ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
    ...params,
    limit,
    offset,
  );
  return { rows, total: countRow?.c ?? 0 };
}

/** @deprecated Prefer listRuntimeEvents — kept for callers that only need a simple recent list. */
export async function listRecentRuntimeEvents(
  db: SqliteDatabase,
  limit = 50,
  sourceId?: string,
): Promise<RuntimeEventRow[]> {
  const result = await listRuntimeEvents(db, { limit, sourceId, offset: 0 });
  return result.rows;
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
  sourceId?: string,
): Promise<InferenceRequestRow[]> {
  if (sourceId) {
    return db.all<InferenceRequestRow[]>(
      `SELECT * FROM inference_requests WHERE status != 'success' AND source_id = ? ORDER BY timestamp DESC LIMIT ?`,
      sourceId,
      limit,
    );
  }
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

export interface InferenceRequestFilter {
  status?: string;
  clientLabel?: string;
  sourceId?: string;
  /** ISO timestamp lower bound (inclusive). */
  since?: string;
  /** ISO timestamp upper bound (inclusive). */
  until?: string;
  limit?: number;
  offset?: number;
}

export async function listInferenceRequests(
  db: SqliteDatabase,
  filter: InferenceRequestFilter = {},
): Promise<PaginatedResult<InferenceRequestDetailRow>> {
  const limit = filter.limit ?? 20;
  const offset = filter.offset ?? 0;
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filter.status) {
    clauses.push("status = ?");
    params.push(filter.status);
  }
  if (filter.clientLabel) {
    clauses.push("client_label = ?");
    params.push(filter.clientLabel);
  }
  if (filter.sourceId) {
    clauses.push("source_id = ?");
    params.push(filter.sourceId);
  }
  if (filter.since) {
    clauses.push("timestamp >= ?");
    params.push(filter.since);
  }
  if (filter.until) {
    clauses.push("timestamp <= ?");
    params.push(filter.until);
  }

  const where = buildWhereSql(clauses);
  const countRow = await db.get<{ c: number }>(
    `SELECT COUNT(*) AS c FROM inference_requests ${where}`,
    ...params,
  );
  const rows = await db.all<InferenceRequestDetailRow[]>(
    `SELECT * FROM inference_requests ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
    ...params,
    limit,
    offset,
  );
  return { rows, total: countRow?.c ?? 0 };
}

/** Recent requests regardless of status — the Runtime page's activity feed. */
export async function listRecentInferenceRequests(
  db: SqliteDatabase,
  limit = 50,
): Promise<InferenceRequestDetailRow[]> {
  const result = await listInferenceRequests(db, { limit, offset: 0 });
  return result.rows;
}

/** Distinct non-null client labels for filter dropdowns. */
export async function listInferenceClientLabels(
  db: SqliteDatabase,
): Promise<string[]> {
  const rows = await db.all<{ client_label: string }[]>(
    `SELECT DISTINCT client_label FROM inference_requests
     WHERE client_label IS NOT NULL AND client_label != ''
     ORDER BY client_label ASC`,
  );
  return rows.map((r) => r.client_label);
}

export interface InferenceClientCountRow {
  clientLabel: string;
  requestCount: number;
  promptTokens: number;
  completionTokens: number;
}

/**
 * Request volume by client_label for the selected Runtime window.
 * Powers the "Requests by backend" card so OpenCode/Hermes traffic is
 * discoverable without knowing internal ids (BSH-89).
 */
export async function listInferenceRequestCountsByClient(
  db: SqliteDatabase,
  opts: { since?: string; sourceId?: string } = {},
): Promise<InferenceClientCountRow[]> {
  const clauses: string[] = ["client_label IS NOT NULL", "client_label != ''"];
  const params: unknown[] = [];
  if (opts.since) {
    clauses.push("timestamp >= ?");
    params.push(opts.since);
  }
  if (opts.sourceId) {
    clauses.push("source_id = ?");
    params.push(opts.sourceId);
  }
  const where = `WHERE ${clauses.join(" AND ")}`;
  const rows = await db.all<
    {
      client_label: string;
      request_count: number;
      prompt_tokens: number | null;
      completion_tokens: number | null;
    }[]
  >(
    `SELECT client_label,
            COUNT(*) AS request_count,
            COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
            COALESCE(SUM(completion_tokens), 0) AS completion_tokens
     FROM inference_requests
     ${where}
     GROUP BY client_label
     ORDER BY request_count DESC, client_label ASC`,
    ...params,
  );
  return rows.map((r) => ({
    clientLabel: r.client_label,
    requestCount: r.request_count,
    promptTokens: Number(r.prompt_tokens ?? 0),
    completionTokens: Number(r.completion_tokens ?? 0),
  }));
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

export interface RuntimeMetrics {
  /** Sum of slots_busy across latest per-backend slot snapshots. */
  activeSlots: number;
  /** Sum of slots_total across latest per-backend slot snapshots. */
  totalSlots: number;
  /** activeSlots / totalSlots, or null when totalSlots is 0. */
  saturationRate: number | null;
  /** Requests per hour over the metrics window (null if window is unbounded). */
  requestThroughputPerHour: number | null;
  /** cancelled / total requests in window (null when total is 0). */
  cancellationRate: number | null;
  /** p50 duration_ms over the window (null when no timed requests). */
  p50LatencyMs: number | null;
  /** p95 duration_ms over the window (null when no timed requests). */
  p95LatencyMs: number | null;
  /** Total inference requests in the metrics window. */
  requestCount: number;
  /** Window lower bound used for rate metrics (ISO), or null for all-time. */
  since: string | null;
  /** Window length in hours used for throughput, or null when unbounded. */
  windowHours: number | null;
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0]!;
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo]!;
  const weight = rank - lo;
  return sorted[lo]! * (1 - weight) + sorted[hi]! * weight;
}

/**
 * Operational metrics for the Runtime page.
 * Slot occupancy is always "current" (latest snapshots). Rate/latency metrics
 * use the optional `since` lower bound so operators can match the UI time range.
 */
export async function getRuntimeMetrics(
  db: SqliteDatabase,
  opts: { since?: string; windowHours?: number | null } = {},
): Promise<RuntimeMetrics> {
  const snapshots = await latestRuntimeSnapshots(db);
  let activeSlots = 0;
  let totalSlots = 0;
  for (const s of snapshots) {
    if (s.kind !== "slots") continue;
    activeSlots += s.slots_busy ?? 0;
    totalSlots += s.slots_total ?? 0;
  }

  const clauses: string[] = [];
  const params: unknown[] = [];
  if (opts.since) {
    clauses.push("timestamp >= ?");
    params.push(opts.since);
  }
  const where = buildWhereSql(clauses);

  const stats = await db.get<{
    total: number;
    cancelled: number;
  }>(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled
     FROM inference_requests ${where}`,
    ...params,
  );

  // Take the most recent timed samples (bounded), then sort by duration for
  // percentile math — avoids loading unbounded history on every poll.
  const durationWhere = where
    ? `${where} AND duration_ms IS NOT NULL`
    : "WHERE duration_ms IS NOT NULL";
  const durations = await db.all<{ duration_ms: number }[]>(
    `SELECT duration_ms FROM (
       SELECT duration_ms FROM inference_requests
       ${durationWhere}
       ORDER BY timestamp DESC
       LIMIT ?
     ) sample
     ORDER BY duration_ms ASC`,
    ...params,
    LATENCY_SAMPLE_LIMIT,
  );

  const sorted = durations.map((d) => d.duration_ms);
  const requestCount = stats?.total ?? 0;
  const cancelled = stats?.cancelled ?? 0;
  const windowHours = opts.windowHours === undefined ? null : opts.windowHours;

  let requestThroughputPerHour: number | null = null;
  if (windowHours != null && windowHours > 0) {
    requestThroughputPerHour = requestCount / windowHours;
  }

  return {
    activeSlots,
    totalSlots,
    saturationRate: totalSlots > 0 ? activeSlots / totalSlots : null,
    requestThroughputPerHour,
    cancellationRate: requestCount > 0 ? cancelled / requestCount : null,
    p50LatencyMs: percentile(sorted, 50),
    p95LatencyMs: percentile(sorted, 95),
    requestCount,
    since: opts.since ?? null,
    windowHours,
  };
}
