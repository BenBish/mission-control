import type { Database as SqliteDatabase } from "sqlite";

/**
 * SQLite's CURRENT_TIMESTAMP (used for last_seen_at in recordHeartbeat)
 * produces a naive "YYYY-MM-DD HH:MM:SS" string with no timezone marker —
 * it's UTC, but `new Date("...")` on a space-separated (non-ISO) string
 * parses it as local time, silently shifting it by the browser's UTC
 * offset. Found live: a real "Last seen -25199s ago" (~-7h, exactly PDT)
 * on the Runtime page. Reshape to real ISO8601 before it leaves the
 * server so every client parses it correctly regardless of timezone.
 */
function toIso(sqliteTimestamp: string | null): string | null {
  if (!sqliteTimestamp) return null;
  return sqliteTimestamp.includes("T")
    ? sqliteTimestamp
    : `${sqliteTimestamp.replace(" ", "T")}Z`;
}

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
  { id: "devin", name: "Devin", kind: "agentic", defaultUnit: "quota" },
  { id: "grok", name: "Grok", kind: "agentic", defaultUnit: "quota" },
  {
    id: "opencode",
    name: "OpenCode",
    kind: "agentic",
    defaultUnit: "quota",
  },
  {
    id: "cloud-handoff",
    name: "Cloud Handoff",
    kind: "agentic",
    defaultUnit: "usd",
  },
  {
    id: "cursor",
    name: "Cursor",
    kind: "agentic",
    defaultUnit: "quota",
  },
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

// Desktop-push instances are not seeded — collector instance ids are
// per-machine (`<source>@<machine>`, machine from collector.toml or
// hostname) and auto-register on first heartbeat/batch via
// ensureSourceInstance below. Only the server-side HTTP pollers keep
// static seeds, since their instance names describe the polled target.
const SEED_INSTANCES: Array<{
  id: string;
  sourceId: string;
  machine: string;
  endpoint: string | null;
  collectorKind: string;
  status: string;
}> = [
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
        lastSeenAt: toIso(i.last_seen_at),
        lastError: i.last_error,
        meta: i.meta ? JSON.parse(i.meta) : null,
      })),
  }));
}

/**
 * Registers an instance row for a known source if one does not already
 * exist. Desktop collectors name their instances `<source>@<machine>`
 * (machine from collector.toml, else hostname), so instance ids cannot be
 * pre-seeded — the first heartbeat or ingest batch creates the row. The
 * machine label is parsed from the `@` suffix; instances for unknown
 * sources are never created (returns false so callers can reject).
 */
export async function ensureSourceInstance(
  db: SqliteDatabase,
  sourceId: string,
  instanceId: string,
): Promise<boolean> {
  const source = await db.get<{ id: string }>(
    `SELECT id FROM sources WHERE id = ?`,
    sourceId,
  );
  if (!source) return false;

  const machine = instanceId.includes("@")
    ? instanceId.slice(instanceId.lastIndexOf("@") + 1)
    : "unknown";
  await db.run(
    `INSERT OR IGNORE INTO source_instances (id, source_id, machine, endpoint, collector_kind, status) VALUES (?, ?, ?, NULL, 'jsonl-push', 'unknown')`,
    instanceId,
    sourceId,
    machine,
  );
  return true;
}

/**
 * Upserts heartbeat status onto a pre-seeded or auto-registered instance
 * row. Returns false if no matching (sourceId, instanceId) row exists —
 * callers should run ensureSourceInstance first when the instance may not
 * be seeded.
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
