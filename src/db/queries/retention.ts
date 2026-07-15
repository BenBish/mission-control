import type { Database as SqliteDatabase } from "sqlite";

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
 * polling — their volume is bounded by real usage, not a 5s timer, so
 * they're out of scope here. Revisit if that assumption stops holding.
 */
const RAW_RETENTION_DAYS = 7;

export interface RetentionResult {
  slotRowsRolledUp: number;
  rollupBucketsWritten: number;
  otherRowsDeleted: number;
}

export async function runRuntimeSnapshotRetention(
  db: SqliteDatabase,
  retentionDays = RAW_RETENTION_DAYS,
): Promise<RetentionResult> {
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
