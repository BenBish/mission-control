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
 * Return the entity bound to an already-recorded natural key. Update-capable
 * replays use this to ensure they can only modify the row created by the
 * original observation.
 */
export async function getDedupeEntityId(
  db: SqliteDatabase,
  sourceId: string,
  instanceId: string,
  kind: string,
  naturalKey: string,
): Promise<string | null> {
  const row = await db.get<{ entity_id: string | null }>(
    `SELECT entity_id
     FROM ingest_dedupe
     WHERE source_id = ? AND instance_id = ? AND kind = ? AND natural_key = ?`,
    sourceId,
    instanceId,
    kind,
    naturalKey,
  );
  return row?.entity_id ?? null;
}

/** Bind a natural key to the entity written for its first observation. */
export async function setDedupeEntityId(
  db: SqliteDatabase,
  sourceId: string,
  instanceId: string,
  kind: string,
  naturalKey: string,
  entityId: string,
): Promise<void> {
  const result = await db.run(
    `UPDATE ingest_dedupe
     SET entity_id = ?
     WHERE source_id = ? AND instance_id = ? AND kind = ? AND natural_key = ?`,
    entityId,
    sourceId,
    instanceId,
    kind,
    naturalKey,
  );
  if (result.changes !== 1) {
    throw new Error(`Unable to bind ingest dedupe key: ${naturalKey}`);
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
