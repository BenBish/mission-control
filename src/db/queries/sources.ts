import type { Database as SqliteDatabase } from "sqlite";

export interface SourceRow {
  id: string;
  name: string;
  kind: string;
  default_unit: string;
}

export interface SourceInstanceRow {
  id: string;
  source_id: string;
  machine: string;
  endpoint: string | null;
  collector_kind: string;
  status: string;
  last_seen_at: string | null;
  last_error: string | null;
  meta: string | null;
}

const SEED_SOURCES: Array<{
  id: string;
  name: string;
  kind: string;
  defaultUnit: string;
}> = [
  {
    id: "claude-code",
    name: "Claude Code",
    kind: "agentic",
    defaultUnit: "quota",
  },
  { id: "codex", name: "Codex CLI", kind: "agentic", defaultUnit: "quota" },
  { id: "hermes", name: "Hermes", kind: "inference", defaultUnit: "compute" },
  {
    id: "lemonade",
    name: "Lemonade",
    kind: "inference",
    defaultUnit: "compute",
  },
  {
    id: "comfyui",
    name: "ComfyUI",
    kind: "generation",
    defaultUnit: "compute",
  },
];

const SEED_INSTANCES: Array<{
  id: string;
  sourceId: string;
  machine: string;
  endpoint: string | null;
  collectorKind: string;
  status: string;
}> = [
  {
    id: "claude-code@arch-desktop",
    sourceId: "claude-code",
    machine: "arch-desktop",
    endpoint: null,
    collectorKind: "jsonl-push",
    status: "unknown",
  },
  {
    id: "codex@arch-desktop",
    sourceId: "codex",
    machine: "arch-desktop",
    endpoint: null,
    collectorKind: "jsonl-push",
    status: "unknown",
  },
  {
    id: "hermes@strix-halo",
    sourceId: "hermes",
    machine: "strix-halo",
    endpoint: "http://127.0.0.1:8080",
    collectorKind: "http-poll",
    status: "unknown",
  },
  {
    id: "lemonade@strix-halo",
    sourceId: "lemonade",
    machine: "strix-halo",
    endpoint: "http://127.0.0.1:13305",
    collectorKind: "http-poll",
    status: "off",
  },
  {
    id: "comfyui@strix-halo",
    sourceId: "comfyui",
    machine: "strix-halo",
    endpoint: null,
    collectorKind: "http-poll",
    status: "off",
  },
];

/** Idempotent — replaces profile-service.ts's systemd discovery with a static registry. */
export async function seedSources(db: SqliteDatabase): Promise<void> {
  for (const s of SEED_SOURCES) {
    await db.run(
      `INSERT OR IGNORE INTO sources (id, name, kind, default_unit) VALUES (?, ?, ?, ?)`,
      s.id,
      s.name,
      s.kind,
      s.defaultUnit,
    );
  }
  for (const i of SEED_INSTANCES) {
    await db.run(
      `INSERT OR IGNORE INTO source_instances (id, source_id, machine, endpoint, collector_kind, status) VALUES (?, ?, ?, ?, ?, ?)`,
      i.id,
      i.sourceId,
      i.machine,
      i.endpoint,
      i.collectorKind,
      i.status,
    );
  }
}

export async function listSources(db: SqliteDatabase) {
  const sources = await db.all<SourceRow[]>(
    `SELECT * FROM sources ORDER BY id`,
  );
  const instances = await db.all<SourceInstanceRow[]>(
    `SELECT * FROM source_instances ORDER BY id`,
  );
  return sources.map((s) => ({
    id: s.id,
    name: s.name,
    kind: s.kind,
    defaultUnit: s.default_unit,
    instances: instances
      .filter((i) => i.source_id === s.id)
      .map((i) => ({
        id: i.id,
        machine: i.machine,
        endpoint: i.endpoint,
        collectorKind: i.collector_kind,
        status: i.status,
        lastSeenAt: i.last_seen_at,
        lastError: i.last_error,
        meta: i.meta ? JSON.parse(i.meta) : null,
      })),
  }));
}

/**
 * Upserts heartbeat status onto a pre-seeded instance row. Returns false if
 * no matching (sourceId, instanceId) row exists — heartbeats never create
 * new instance rows themselves, since collector_kind/machine must be known
 * up front (set in the seed above).
 */
export async function recordHeartbeat(
  db: SqliteDatabase,
  sourceId: string,
  instanceId: string,
  status: string,
  error?: string,
): Promise<boolean> {
  const result = await db.run(
    `UPDATE source_instances SET status = ?, last_seen_at = CURRENT_TIMESTAMP, last_error = ? WHERE id = ? AND source_id = ?`,
    status,
    error ?? null,
    instanceId,
    sourceId,
  );
  return (result.changes ?? 0) > 0;
}
