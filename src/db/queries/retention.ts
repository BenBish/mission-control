import type { Database as SqliteDatabase } from "sqlite";
import type { RetentionPolicy } from "../../server/privacy/policy.js";

/**
 * runtime_snapshots is a 5s-interval time series (Hermes slot polling) —
 * unlike everything else in the schema, it has no natural event-driven
 * upper bound on volume. Observed live: ~3500 rows/78min on a single
 * Hermes instance with 3 backends, i.e. tens of thousands of rows/day.
 * Left unpruned this grows without bound for as long as polling runs.
 *
 * Only 'slots' rows get rolled up (hourly avg/max per instance+port) —
 * the only kind with a numeric time series worth summarizing long-term.
 * 'health'/'models'/'system' snapshots are only ever queried as "latest"
 * (see latestRuntimeSnapshots in telemetry.ts), so raw rows past the
 * retention window are just deleted, not aggregated — there's no
 * long-term trend anyone queries from those.
 *
 * inference_requests/runtime_events/quota_snapshots are event-driven
 * (one row per actual request/transition/quota-check), not fixed-interval
 * polling — their volume is bounded by real usage, not a 5s timer.
 * BSH-100 adds configurable retention by data class for those plus
 * activities/sessions/generation content.
 */
const RAW_RETENTION_DAYS = 7;

export interface RuntimeRetentionResult {
  slotRowsRolledUp: number;
  rollupBucketsWritten: number;
  otherRowsDeleted: number;
}

export async function runRuntimeSnapshotRetention(
  db: SqliteDatabase,
  retentionDays = RAW_RETENTION_DAYS,
): Promise<RuntimeRetentionResult> {
  const cutoff = new Date(
    Date.now() - retentionDays * 24 * 3600_000,
  ).toISOString();

  const rollupResult = await db.run(
    `INSERT INTO runtime_slot_rollups
       (source_id, instance_id, port, hour_bucket, sample_count, slots_total_avg, slots_busy_avg, slots_busy_max)
     SELECT
       source_id,
       instance_id,
       CAST(json_extract(payload, '$.port') AS INTEGER) AS port,
       strftime('%Y-%m-%dT%H:00:00Z', timestamp) AS hour_bucket,
       COUNT(*),
       AVG(slots_total),
       AVG(slots_busy),
       MAX(slots_busy)
     FROM runtime_snapshots
     WHERE kind = 'slots' AND timestamp < ?
     GROUP BY source_id, instance_id, port, hour_bucket
     ON CONFLICT (instance_id, port, hour_bucket) DO UPDATE SET
       -- Weighted merge, not overwrite: a bucket can be reprocessed if
       -- late/out-of-order data lands in an already-rolled-up hour (e.g.
       -- catching up after a long outage). Overwriting would silently
       -- discard the samples the previous pass already rolled up.
       sample_count = runtime_slot_rollups.sample_count + excluded.sample_count,
       slots_total_avg = (
         runtime_slot_rollups.slots_total_avg * runtime_slot_rollups.sample_count
         + excluded.slots_total_avg * excluded.sample_count
       ) / (runtime_slot_rollups.sample_count + excluded.sample_count),
       slots_busy_avg = (
         runtime_slot_rollups.slots_busy_avg * runtime_slot_rollups.sample_count
         + excluded.slots_busy_avg * excluded.sample_count
       ) / (runtime_slot_rollups.sample_count + excluded.sample_count),
       slots_busy_max = MAX(runtime_slot_rollups.slots_busy_max, excluded.slots_busy_max)`,
    cutoff,
  );

  const deleteSlots = await db.run(
    `DELETE FROM runtime_snapshots WHERE kind = 'slots' AND timestamp < ?`,
    cutoff,
  );
  const deleteOther = await db.run(
    `DELETE FROM runtime_snapshots WHERE kind != 'slots' AND timestamp < ?`,
    cutoff,
  );

  return {
    slotRowsRolledUp: deleteSlots.changes ?? 0,
    rollupBucketsWritten: rollupResult.changes ?? 0,
    otherRowsDeleted: deleteOther.changes ?? 0,
  };
}

export interface DataClassPurgeResult {
  activitiesDeleted: number;
  sessionsDeleted: number;
  inferenceDeleted: number;
  runtimeEventsDeleted: number;
  quotaSnapshotsDeleted: number;
  generationJobsDeleted: number;
  jobRunsDeleted: number;
  runtime: RuntimeRetentionResult;
}

function cutoffIso(days: number): string {
  return new Date(Date.now() - days * 24 * 3600_000).toISOString();
}

/**
 * Enforce retention by data class. Safe ordering: delete children
 * (activities) before sessions; runtime snapshots via rollup path.
 *
 * Does not touch provider_usage_daily / spend budgets (billing aggregates).
 */
export async function runDataClassRetention(
  db: SqliteDatabase,
  retention: RetentionPolicy,
): Promise<DataClassPurgeResult> {
  const activitiesCutoff = cutoffIso(retention.activitiesDays);
  const sessionsCutoff = cutoffIso(retention.sessionsDays);
  const inferenceCutoff = cutoffIso(retention.inferenceDays);
  const generationsCutoff = cutoffIso(retention.generationsDays);
  const jobsCutoff = cutoffIso(retention.jobsDays);

  // Activities first (FK → sessions)
  const activities = await db.run(
    `DELETE FROM activities WHERE timestamp < ?`,
    activitiesCutoff,
  );

  // Sessions only when ended (or started) past cutoff and no remaining activities
  const sessions = await db.run(
    `DELETE FROM sessions
     WHERE COALESCE(ended_at, started_at) < ?
       AND NOT EXISTS (
         SELECT 1 FROM activities a WHERE a.session_id = sessions.id
       )`,
    sessionsCutoff,
  );

  const inference = await db.run(
    `DELETE FROM inference_requests WHERE timestamp < ?`,
    inferenceCutoff,
  );

  const runtimeEvents = await db.run(
    `DELETE FROM runtime_events WHERE timestamp < ?`,
    cutoffIso(retention.runtimeDays),
  );

  const quota = await db.run(
    `DELETE FROM quota_snapshots WHERE timestamp < ?`,
    inferenceCutoff,
  );

  const generations = await db.run(
    `DELETE FROM generation_jobs
     WHERE COALESCE(observed_completed_at, first_seen_at) < ?`,
    generationsCutoff,
  );

  const jobRuns = await db.run(
    `DELETE FROM job_runs WHERE COALESCE(ended_at, started_at) < ?`,
    jobsCutoff,
  );

  const runtime = await runRuntimeSnapshotRetention(db, retention.runtimeDays);

  // Prune old ingest_dedupe so re-ingests of purged content are not
  // permanently blocked (natural keys are content-addressed).
  await db.run(
    `DELETE FROM ingest_dedupe WHERE created_at < ?`,
    activitiesCutoff,
  );

  return {
    activitiesDeleted: activities.changes ?? 0,
    sessionsDeleted: sessions.changes ?? 0,
    inferenceDeleted: inference.changes ?? 0,
    runtimeEventsDeleted: runtimeEvents.changes ?? 0,
    quotaSnapshotsDeleted: quota.changes ?? 0,
    generationJobsDeleted: generations.changes ?? 0,
    jobRunsDeleted: jobRuns.changes ?? 0,
    runtime,
  };
}

/**
 * One-shot redaction of *existing* stored sensitive fields (migration path).
 * Overwrites description (truncated + secret scrub), nulls details/result for
 * prompt-like rows, and clears tool body JSON when policy would have stripped it.
 *
 * Safe to re-run; not a full historical rebuild of project labels.
 */
export async function purgeSensitiveStoredFields(
  db: SqliteDatabase,
  opts?: { strict?: boolean },
): Promise<{ activitiesUpdated: number }> {
  const strict = opts?.strict === true;

  // Null tool/result payloads (largest sensitive surface)
  const details = await db.run(
    `UPDATE activities
     SET details = NULL,
         result = NULL,
         metadata = CASE WHEN metadata IS NOT NULL THEN '{}' ELSE metadata END
     WHERE details IS NOT NULL OR result IS NOT NULL`,
  );

  if (strict) {
    // Truncate long descriptions that look like free-text prompts
    await db.run(
      `UPDATE activities
       SET description = substr(description, 1, 120) || '…[truncated]'
       WHERE length(description) > 120
         AND action_type IN ('user_request', 'message', 'decision')`,
    );
  }

  return { activitiesUpdated: details.changes ?? 0 };
}
