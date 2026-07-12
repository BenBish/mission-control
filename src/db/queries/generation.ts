import type { Database as SqliteDatabase } from "sqlite";
import type { GenerationJobPayload } from "../../types/ingest.js";

export async function upsertGenerationJob(
  db: SqliteDatabase,
  sourceId: string,
  instanceId: string,
  payload: GenerationJobPayload,
): Promise<void> {
  const id = `${sourceId}:${instanceId}:${payload.externalId}`;
  await db.run(
    `INSERT INTO generation_jobs (
       id, source_id, instance_id, external_id, status, first_seen_at,
       observed_started_at, observed_completed_at, workflow_hash, node_count,
       output_count, details
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_id, instance_id, external_id) DO UPDATE SET
       status = excluded.status,
       observed_started_at = COALESCE(generation_jobs.observed_started_at, excluded.observed_started_at),
       observed_completed_at = COALESCE(excluded.observed_completed_at, generation_jobs.observed_completed_at),
       node_count = COALESCE(excluded.node_count, generation_jobs.node_count),
       output_count = COALESCE(excluded.output_count, generation_jobs.output_count),
       details = COALESCE(excluded.details, generation_jobs.details)`,
    id,
    sourceId,
    instanceId,
    payload.externalId,
    payload.status,
    payload.firstSeenAt,
    payload.observedStartedAt ?? null,
    payload.observedCompletedAt ?? null,
    payload.workflowHash ?? null,
    payload.nodeCount ?? null,
    payload.outputCount ?? null,
    payload.details != null ? JSON.stringify(payload.details) : null,
  );
}

export interface GenerationJobRow {
  id: string;
  source_id: string;
  instance_id: string;
  external_id: string;
  status: string;
  first_seen_at: string;
  observed_started_at: string | null;
  observed_completed_at: string | null;
  workflow_hash: string | null;
  node_count: number | null;
  output_count: number | null;
  details: string | null;
}

export async function listGenerationJobs(
  db: SqliteDatabase,
  limit = 50,
): Promise<GenerationJobRow[]> {
  return db.all<GenerationJobRow[]>(
    `SELECT * FROM generation_jobs ORDER BY first_seen_at DESC LIMIT ?`,
    limit,
  );
}
