/**
 * Spend alert event store — threshold / anomaly delivery state and history.
 * Alerts are persisted when insights are loaded so operators see more than a
 * transient card; delivery_state tracks pending → delivered → acknowledged.
 */

import { randomUUID } from "crypto";
import type { Database as SqliteDatabase } from "sqlite";

export type SpendAlertKind = "threshold" | "anomaly";
export type SpendAlertSeverity = "info" | "warn" | "critical";
export type SpendAlertDataClass = "cost" | "quota" | "wallet";
export type SpendAlertDeliveryState =
  | "pending"
  | "delivered"
  | "acknowledged"
  | "suppressed"
  | "failed";

export interface SpendAlertRow {
  id: string;
  kind: SpendAlertKind;
  severity: SpendAlertSeverity;
  data_class?: SpendAlertDataClass | null;
  scope_type: string | null;
  scope_key: string | null;
  title: string;
  message: string;
  evidence_json: string | null;
  estimated_impact_usd: number | null;
  delivery_state: SpendAlertDeliveryState;
  delivered_at: string | null;
  acknowledged_at: string | null;
  fingerprint: string;
  month_key: string;
  created_at: string | null;
  updated_at: string | null;
}

export interface SpendAlert {
  id: string;
  kind: SpendAlertKind;
  severity: SpendAlertSeverity;
  dataClass: SpendAlertDataClass;
  scopeType: string | null;
  scopeKey: string | null;
  title: string;
  message: string;
  evidence: Record<string, unknown> | null;
  estimatedImpactUsd: number | null;
  deliveryState: SpendAlertDeliveryState;
  deliveredAt: string | null;
  acknowledgedAt: string | null;
  fingerprint: string;
  monthKey: string;
  createdAt: string | null;
  updatedAt: string | null;
}

function parseEvidence(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function parseDataClass(raw: string | null | undefined): SpendAlertDataClass {
  if (raw === "quota" || raw === "wallet" || raw === "cost") return raw;
  return "cost";
}

function rowToAlert(row: SpendAlertRow): SpendAlert {
  return {
    id: row.id,
    kind: row.kind,
    severity: row.severity,
    dataClass: parseDataClass(row.data_class),
    scopeType: row.scope_type,
    scopeKey: row.scope_key,
    title: row.title,
    message: row.message,
    evidence: parseEvidence(row.evidence_json),
    estimatedImpactUsd: row.estimated_impact_usd,
    deliveryState: row.delivery_state,
    deliveredAt: row.delivered_at,
    acknowledgedAt: row.acknowledged_at,
    fingerprint: row.fingerprint,
    monthKey: row.month_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listSpendAlerts(
  db: SqliteDatabase,
  opts: {
    limit?: number;
    monthKey?: string;
    deliveryState?: SpendAlertDeliveryState;
    dataClass?: SpendAlertDataClass;
  } = {},
): Promise<SpendAlert[]> {
  const limit =
    opts.limit != null && Number.isFinite(opts.limit)
      ? Math.min(500, Math.max(1, Math.floor(opts.limit)))
      : 50;
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (opts.monthKey) {
    clauses.push("month_key = ?");
    params.push(opts.monthKey);
  }
  if (opts.deliveryState) {
    clauses.push("delivery_state = ?");
    params.push(opts.deliveryState);
  }
  if (opts.dataClass) {
    clauses.push("data_class = ?");
    params.push(opts.dataClass);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = await db.all<SpendAlertRow[]>(
    `SELECT * FROM spend_alert_events ${where}
     ORDER BY created_at DESC LIMIT ?`,
    ...params,
    limit,
  );
  return rows.map(rowToAlert);
}

/**
 * Insert a new alert only when no row with the same fingerprint+month exists.
 * Returns the existing or newly created alert.
 */
export async function upsertSpendAlertByFingerprint(
  db: SqliteDatabase,
  input: {
    kind: SpendAlertKind;
    severity: SpendAlertSeverity;
    dataClass?: SpendAlertDataClass;
    scopeType?: string | null;
    scopeKey?: string | null;
    title: string;
    message: string;
    evidence?: Record<string, unknown> | null;
    estimatedImpactUsd?: number | null;
    fingerprint: string;
    monthKey: string;
    /** When true, mark newly created rows as delivered immediately (in-app). */
    autoDeliver?: boolean;
  },
): Promise<{ alert: SpendAlert; created: boolean }> {
  const existing = await db.get<SpendAlertRow>(
    `SELECT * FROM spend_alert_events
     WHERE fingerprint = ? AND month_key = ?
     ORDER BY created_at DESC LIMIT 1`,
    input.fingerprint,
    input.monthKey,
  );
  if (existing) {
    return { alert: rowToAlert(existing), created: false };
  }

  const id = randomUUID();
  const deliveryState: SpendAlertDeliveryState = input.autoDeliver
    ? "delivered"
    : "pending";
  const deliveredAt = input.autoDeliver ? new Date().toISOString() : null;
  const evidenceJson = input.evidence ? JSON.stringify(input.evidence) : null;

  try {
    await db.run(
      `
    INSERT INTO spend_alert_events (
      id, kind, severity, data_class, scope_type, scope_key, title, message,
      evidence_json, estimated_impact_usd, delivery_state, delivered_at,
      fingerprint, month_key, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `,
      id,
      input.kind,
      input.severity,
      input.dataClass ?? "cost",
      input.scopeType ?? null,
      input.scopeKey ?? null,
      input.title,
      input.message,
      evidenceJson,
      input.estimatedImpactUsd ?? null,
      deliveryState,
      deliveredAt,
      input.fingerprint,
      input.monthKey,
    );
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code: unknown }).code)
        : "";
    const message = err instanceof Error ? err.message : String(err);
    if (code === "SQLITE_CONSTRAINT" || /UNIQUE constraint/i.test(message)) {
      const raced = await db.get<SpendAlertRow>(
        `SELECT * FROM spend_alert_events
         WHERE fingerprint = ? AND month_key = ?
         ORDER BY created_at DESC LIMIT 1`,
        input.fingerprint,
        input.monthKey,
      );
      if (raced) return { alert: rowToAlert(raced), created: false };
    }
    throw err;
  }

  const row = await db.get<SpendAlertRow>(
    `SELECT * FROM spend_alert_events WHERE id = ?`,
    id,
  );
  if (!row) throw new Error("Failed to persist spend alert");
  return { alert: rowToAlert(row), created: true };
}

export async function updateSpendAlertDelivery(
  db: SqliteDatabase,
  id: string,
  state: SpendAlertDeliveryState,
): Promise<SpendAlert | null> {
  const existing = await db.get<SpendAlertRow>(
    `SELECT * FROM spend_alert_events WHERE id = ?`,
    id,
  );
  if (!existing) return null;

  const now = new Date().toISOString();
  let deliveredAt = existing.delivered_at;
  let acknowledgedAt = existing.acknowledged_at;
  if (state === "delivered" && !deliveredAt) deliveredAt = now;
  if (state === "acknowledged") {
    acknowledgedAt = now;
    if (!deliveredAt) deliveredAt = now;
  }

  await db.run(
    `
    UPDATE spend_alert_events
    SET delivery_state = ?,
        delivered_at = ?,
        acknowledged_at = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    `,
    state,
    deliveredAt,
    acknowledgedAt,
    id,
  );

  const row = await db.get<SpendAlertRow>(
    `SELECT * FROM spend_alert_events WHERE id = ?`,
    id,
  );
  return row ? rowToAlert(row) : null;
}
