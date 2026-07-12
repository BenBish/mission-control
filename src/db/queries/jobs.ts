import type { Database as SqliteDatabase } from "sqlite";
import { v7 as uuidv7 } from "uuid";
import type { JobRunPayload } from "../../types/ingest.js";

export async function upsertJobRun(
  db: SqliteDatabase,
  sourceId: string,
  payload: JobRunPayload,
): Promise<void> {
  await db.run(
    `INSERT INTO background_jobs (id, source_id, name, kind, enabled)
     VALUES (?, ?, ?, ?, 1)
     ON CONFLICT(id) DO NOTHING`,
    payload.jobId,
    sourceId,
    payload.jobName ?? payload.jobId,
    payload.jobKind ?? "inferred",
  );

  const id = uuidv7();
  await db.run(
    `INSERT INTO job_runs (
       id, job_id, started_at, ended_at, status, duration_ms, output, error, details
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    payload.jobId,
    payload.startedAt,
    payload.endedAt ?? null,
    payload.status,
    payload.durationMs ?? null,
    payload.output ?? null,
    payload.error ?? null,
    payload.details != null ? JSON.stringify(payload.details) : null,
  );
}

export interface BackgroundJobRow {
  id: string;
  source_id: string;
  name: string;
  kind: string;
  enabled: number;
  meta: string | null;
  created_at: string;
}

export interface JobRunRow {
  id: string;
  job_id: string;
  started_at: string;
  ended_at: string | null;
  status: string;
  duration_ms: number | null;
  output: string | null;
  error: string | null;
  details: string | null;
}

export async function listBackgroundJobs(
  db: SqliteDatabase,
): Promise<BackgroundJobRow[]> {
  return db.all<BackgroundJobRow[]>(
    `SELECT * FROM background_jobs ORDER BY name`,
  );
}

export async function getBackgroundJob(
  db: SqliteDatabase,
  id: string,
): Promise<BackgroundJobRow | undefined> {
  return db.get<BackgroundJobRow>(
    `SELECT * FROM background_jobs WHERE id = ?`,
    id,
  );
}

export async function listJobRuns(
  db: SqliteDatabase,
  jobId: string,
  limit = 50,
): Promise<JobRunRow[]> {
  return db.all<JobRunRow[]>(
    `SELECT * FROM job_runs WHERE job_id = ? ORDER BY started_at DESC LIMIT ?`,
    jobId,
    limit,
  );
}

export async function latestJobRun(
  db: SqliteDatabase,
  jobId: string,
): Promise<JobRunRow | undefined> {
  return db.get<JobRunRow>(
    `SELECT * FROM job_runs WHERE job_id = ? ORDER BY started_at DESC LIMIT 1`,
    jobId,
  );
}
