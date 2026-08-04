import type { Database as SqliteDatabase } from "sqlite";

/**
 * Generic ingest idempotency check, independent of each entity table's own
 * UNIQUE shape — see ingest_dedupe in src/db/schema.ts.
 *
 * Returns true if this natural key has already been ingested (a duplicate —
 * the caller should skip reprocessing it). Returns false and records the key
 * on first sight.
 *
 * Callers that may fail after recording must call {@link releaseDedupe} so a
 * later retry is not permanently blocked (BSH-90: tool completion inserts
 * failed UNIQUE while their natural keys stayed burned).
 */
export async function checkAndRecordDedupe(
  db: SqliteDatabase,
  sourceId: string,
  instanceId: string,
  kind: string,
  naturalKey: string,
  entityId?: string,
): Promise<boolean> {
  try {
    await db.run(
      `INSERT INTO ingest_dedupe (source_id, instance_id, kind, natural_key, entity_id) VALUES (?, ?, ?, ?, ?)`,
      sourceId,
      instanceId,
      kind,
      naturalKey,
      entityId ?? null,
    );
    return false;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("UNIQUE constraint failed")) {
      return true;
    }
    throw err;
  }
}

/**
 * Undo a just-recorded natural key after the write that followed it failed.
 * Safe to call when the key was never recorded (no-op delete).
 */
export async function releaseDedupe(
  db: SqliteDatabase,
  sourceId: string,
  instanceId: string,
  kind: string,
  naturalKey: string,
): Promise<void> {
  await db.run(
    `DELETE FROM ingest_dedupe
     WHERE source_id = ? AND instance_id = ? AND kind = ? AND natural_key = ?`,
    sourceId,
    instanceId,
    kind,
    naturalKey,
  );
}
