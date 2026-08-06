/**
 * Operator triage state for failure fingerprint groups.
 * Keyed by fingerprint only — never mutates raw failure source tables.
 */

import type { Database as SqliteDatabase } from "sqlite";
import type {
  FailureIncidentState,
  FailureTriageStatus,
  UpdateFailureIncidentInput,
} from "../../types/failures.js";

interface IncidentRow {
  fingerprint: string;
  triage_status: string;
  owner: string | null;
  resolution_reason: string | null;
  runbook_url: string | null;
  notes: string | null;
  acknowledged_at: string | null;
  snoozed_until: string | null;
  resolved_at: string | null;
  updated_at: string | null;
}

const VALID_TRIAGE = new Set<FailureTriageStatus>([
  "open",
  "acknowledged",
  "snoozed",
  "resolved",
]);

export function isValidTriageStatus(
  value: unknown,
): value is FailureTriageStatus {
  return (
    typeof value === "string" && VALID_TRIAGE.has(value as FailureTriageStatus)
  );
}

function rowToState(row: IncidentRow): FailureIncidentState {
  return {
    fingerprint: row.fingerprint,
    triageStatus: (row.triage_status as FailureTriageStatus) || "open",
    owner: row.owner ?? undefined,
    resolutionReason: row.resolution_reason ?? undefined,
    runbookUrl: row.runbook_url ?? undefined,
    notes: row.notes ?? undefined,
    acknowledgedAt: row.acknowledged_at ?? undefined,
    snoozedUntil: row.snoozed_until ?? undefined,
    resolvedAt: row.resolved_at ?? undefined,
    updatedAt: row.updated_at ?? undefined,
  };
}

export async function getFailureIncidentState(
  db: SqliteDatabase,
  fingerprint: string,
): Promise<FailureIncidentState | null> {
  const row = await db.get<IncidentRow>(
    `SELECT fingerprint, triage_status, owner, resolution_reason, runbook_url,
            notes, acknowledged_at, snoozed_until, resolved_at, updated_at
     FROM failure_incident_state
     WHERE fingerprint = ?`,
    fingerprint,
  );
  return row ? rowToState(row) : null;
}

/**
 * Bulk-load triage state for a set of fingerprints.
 */
export async function listFailureIncidentStates(
  db: SqliteDatabase,
  fingerprints: string[],
): Promise<Map<string, FailureIncidentState>> {
  const map = new Map<string, FailureIncidentState>();
  if (fingerprints.length === 0) return map;

  // SQLite variable limit is high enough for operator-scale group pages.
  const placeholders = fingerprints.map(() => "?").join(",");
  const rows = await db.all<IncidentRow[]>(
    `SELECT fingerprint, triage_status, owner, resolution_reason, runbook_url,
            notes, acknowledged_at, snoozed_until, resolved_at, updated_at
     FROM failure_incident_state
     WHERE fingerprint IN (${placeholders})`,
    ...fingerprints,
  );
  for (const row of rows) {
    map.set(row.fingerprint, rowToState(row));
  }
  return map;
}

function trimOrNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const t = value.trim();
  return t === "" ? null : t;
}

/**
 * Upsert triage metadata for a fingerprint group.
 * Empty-string owner/reason/url clears the field (stored as NULL).
 */
export async function upsertFailureIncidentState(
  db: SqliteDatabase,
  fingerprint: string,
  input: UpdateFailureIncidentInput,
  now: Date = new Date(),
): Promise<FailureIncidentState> {
  const fp = fingerprint.trim();
  if (!fp) {
    throw new Error("fingerprint is required");
  }

  const existing = await getFailureIncidentState(db, fp);
  const nowIso = now.toISOString();

  let triageStatus: FailureTriageStatus =
    input.triageStatus ?? existing?.triageStatus ?? "open";
  if (input.triageStatus && !isValidTriageStatus(input.triageStatus)) {
    throw new Error(
      "triageStatus must be one of: open, acknowledged, snoozed, resolved",
    );
  }

  const owner =
    input.owner !== undefined
      ? trimOrNull(input.owner)
      : (existing?.owner ?? null);
  const resolutionReason =
    input.resolutionReason !== undefined
      ? trimOrNull(input.resolutionReason)
      : (existing?.resolutionReason ?? null);
  const runbookUrl =
    input.runbookUrl !== undefined
      ? trimOrNull(input.runbookUrl)
      : (existing?.runbookUrl ?? null);
  const notes =
    input.notes !== undefined
      ? trimOrNull(input.notes)
      : (existing?.notes ?? null);

  let acknowledgedAt = existing?.acknowledgedAt ?? null;
  let snoozedUntil =
    input.snoozedUntil !== undefined
      ? trimOrNull(input.snoozedUntil)
      : (existing?.snoozedUntil ?? null);
  let resolvedAt = existing?.resolvedAt ?? null;

  if (triageStatus === "acknowledged") {
    acknowledgedAt = acknowledgedAt ?? nowIso;
    // Ack clears an active snooze unless a new snoozedUntil was provided.
    if (input.snoozedUntil === undefined) snoozedUntil = null;
  } else if (triageStatus === "snoozed") {
    if (!snoozedUntil) {
      // Default snooze: 24h from now when status is snoozed without a timestamp.
      snoozedUntil = new Date(
        now.getTime() + 24 * 60 * 60 * 1000,
      ).toISOString();
    }
    acknowledgedAt = acknowledgedAt ?? nowIso;
  } else if (triageStatus === "resolved") {
    resolvedAt = nowIso;
    snoozedUntil = null;
  } else if (triageStatus === "open") {
    // Re-open clears resolution timestamps; keep historical ack optional.
    resolvedAt = null;
    if (input.snoozedUntil === undefined) snoozedUntil = null;
  }

  // When explicitly snoozing, force status.
  if (input.snoozedUntil && triageStatus === "open") {
    triageStatus = "snoozed";
  }

  await db.run(
    `INSERT INTO failure_incident_state (
       fingerprint, triage_status, owner, resolution_reason, runbook_url, notes,
       acknowledged_at, snoozed_until, resolved_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(fingerprint) DO UPDATE SET
       triage_status = excluded.triage_status,
       owner = excluded.owner,
       resolution_reason = excluded.resolution_reason,
       runbook_url = excluded.runbook_url,
       notes = excluded.notes,
       acknowledged_at = excluded.acknowledged_at,
       snoozed_until = excluded.snoozed_until,
       resolved_at = excluded.resolved_at,
       updated_at = excluded.updated_at`,
    fp,
    triageStatus,
    owner,
    resolutionReason,
    runbookUrl,
    notes,
    acknowledgedAt,
    snoozedUntil,
    resolvedAt,
    nowIso,
    nowIso,
  );

  const saved = await getFailureIncidentState(db, fp);
  if (!saved) {
    throw new Error("Failed to persist failure incident state");
  }
  return saved;
}

/**
 * Effective triage status considering snooze expiry.
 * Expired snoozes surface as open for prioritization without rewriting the row.
 */
export function effectiveTriageStatus(
  state: FailureIncidentState | null | undefined,
  now: Date = new Date(),
): FailureTriageStatus {
  if (!state) return "open";
  if (state.triageStatus === "snoozed" && state.snoozedUntil) {
    const until = Date.parse(state.snoozedUntil);
    if (Number.isFinite(until) && until <= now.getTime()) {
      return "open";
    }
  }
  return state.triageStatus;
}
