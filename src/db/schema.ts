/**
 * SQLite Database Schema
 *
 * Three shapes, three homes — see docs/ARCHITECTURE.md:
 *  (a) agentic sessions/activities — Claude Code, Codex
 *  (b) inference + runtime telemetry — Hermes, Lemonade
 *  (c) generation jobs — ComfyUI
 * plus a source/instance registry, quota telemetry, and background jobs
 * (backs the repurposed Cron UI: Hermes background work + collector
 * self-observation).
 */

export const SCHEMA_SQL = `
-- Enable WAL mode for better concurrency
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA foreign_keys=ON;

-- ============================================================================
-- REGISTRY (replaces profiles/profile-service)
-- ============================================================================

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('agentic', 'inference', 'generation', 'cloud-usage')),
  default_unit TEXT NOT NULL CHECK (default_unit IN ('quota', 'compute', 'usd')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS source_instances (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  machine TEXT NOT NULL,
  endpoint TEXT,
  collector_kind TEXT NOT NULL CHECK (collector_kind IN ('jsonl-push', 'http-poll')),
  status TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('ok', 'off', 'error', 'unknown')),
  last_seen_at DATETIME,
  last_error TEXT,
  meta JSON,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (source_id) REFERENCES sources(id)
);

CREATE INDEX IF NOT EXISTS idx_source_instances_source ON source_instances(source_id);

-- ============================================================================
-- SHAPE (a): AGENTIC — Claude Code, Codex
-- ============================================================================

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  external_id TEXT NOT NULL,

  cwd TEXT,
  git_branch TEXT,
  title TEXT,
  client_version TEXT,
  model_provider TEXT,

  started_at DATETIME NOT NULL,
  ended_at DATETIME,
  turn_count INTEGER DEFAULT 0,
  tool_call_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,

  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cache_read_tokens INTEGER DEFAULT 0,
  cache_write_tokens INTEGER DEFAULT 0,
  cost_usd REAL,

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (source_id) REFERENCES sources(id),
  FOREIGN KEY (instance_id) REFERENCES source_instances(id),
  UNIQUE (source_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_source ON sessions(source_id);

CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  external_id TEXT,
  parent_activity_id TEXT,
  parent_external_id TEXT,

  timestamp DATETIME NOT NULL,
  completed_at DATETIME,
  duration_ms INTEGER,

  actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'agent', 'subagent', 'system')),
  actor_id TEXT NOT NULL,
  actor_role TEXT,
  actor_session_label TEXT,

  action_type TEXT NOT NULL CHECK (action_type IN (
    'tool_call', 'delegation', 'api_call', 'decision', 'message',
    'event', 'user_request', 'agent_spawn', 'session_start', 'session_end'
  )),
  tool_name TEXT,
  description TEXT NOT NULL,
  details JSON,

  status TEXT NOT NULL,
  result JSON,

  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_write_tokens INTEGER,
  model TEXT,
  cost_usd REAL,
  request_id TEXT,

  tags TEXT,
  references_json JSON,
  metadata JSON,

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (source_id) REFERENCES sources(id),
  FOREIGN KEY (instance_id) REFERENCES source_instances(id),
  FOREIGN KEY (session_id) REFERENCES sessions(id),
  FOREIGN KEY (parent_activity_id) REFERENCES activities(id),
  UNIQUE (source_id, session_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_activities_timestamp ON activities(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_activities_session ON activities(session_id);
CREATE INDEX IF NOT EXISTS idx_activities_actor ON activities(actor_id);
CREATE INDEX IF NOT EXISTS idx_activities_status ON activities(status);
CREATE INDEX IF NOT EXISTS idx_activities_tool ON activities(tool_name);
CREATE INDEX IF NOT EXISTS idx_activities_sidechain ON activities(session_id, parent_external_id);

-- ============================================================================
-- SHAPE (b): INFERENCE + RUNTIME — Hermes, Lemonade
-- ============================================================================

CREATE TABLE IF NOT EXISTS inference_requests (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  external_id TEXT,
  timestamp DATETIME NOT NULL,
  model TEXT,
  endpoint TEXT,
  client_label TEXT,
  workload TEXT NOT NULL DEFAULT 'unknown' CHECK (workload IN ('foreground', 'background', 'unknown')),

  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  cached_tokens INTEGER,

  ttft_ms INTEGER,
  duration_ms INTEGER,
  tokens_per_sec REAL,
  slot_id INTEGER,

  status TEXT NOT NULL CHECK (status IN ('success', 'cancelled', 'context_overflow', 'error')),
  error TEXT,
  details JSON,

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (source_id) REFERENCES sources(id),
  FOREIGN KEY (instance_id) REFERENCES source_instances(id),
  UNIQUE (source_id, instance_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_inference_requests_timestamp ON inference_requests(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_inference_requests_workload ON inference_requests(workload);
CREATE INDEX IF NOT EXISTS idx_inference_requests_status ON inference_requests(status);

CREATE TABLE IF NOT EXISTS runtime_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  timestamp DATETIME NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('slots', 'health', 'system', 'models')),
  slots_total INTEGER,
  slots_busy INTEGER,
  models_loaded JSON,
  healthy INTEGER,
  payload JSON,

  FOREIGN KEY (source_id) REFERENCES sources(id),
  FOREIGN KEY (instance_id) REFERENCES source_instances(id)
);

CREATE INDEX IF NOT EXISTS idx_runtime_snapshots_lookup ON runtime_snapshots(source_id, kind, timestamp DESC);

-- Hourly rollup for 'slots' snapshots — the only kind with a numeric
-- time series worth summarizing long-term (health/models snapshots only
-- ever get queried as "latest", so raw history beyond the retention
-- window is just pruned, not rolled up). Retention job (see
-- src/db/queries/retention.ts) aggregates raw 'slots' rows older than
-- RAW_RETENTION_DAYS into one row per (instance, port, hour), then
-- deletes the raw rows — keeps long-term occupancy trend queryable
-- without an unbounded 5s-interval table.
CREATE TABLE IF NOT EXISTS runtime_slot_rollups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  port INTEGER,
  hour_bucket DATETIME NOT NULL,
  sample_count INTEGER NOT NULL,
  slots_total_avg REAL,
  slots_busy_avg REAL,
  slots_busy_max INTEGER,

  FOREIGN KEY (source_id) REFERENCES sources(id),
  FOREIGN KEY (instance_id) REFERENCES source_instances(id),
  UNIQUE (instance_id, port, hour_bucket)
);

CREATE INDEX IF NOT EXISTS idx_runtime_slot_rollups_lookup ON runtime_slot_rollups(instance_id, hour_bucket DESC);

CREATE TABLE IF NOT EXISTS runtime_events (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  timestamp DATETIME NOT NULL,
  ended_at DATETIME,
  kind TEXT NOT NULL CHECK (kind IN (
    'slots_saturated', 'model_load', 'model_unload', 'service_down',
    'service_up', 'context_overflow', 'request_cancelled'
  )),
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'error')),
  summary TEXT NOT NULL,
  details JSON,

  FOREIGN KEY (source_id) REFERENCES sources(id),
  FOREIGN KEY (instance_id) REFERENCES source_instances(id)
);

CREATE INDEX IF NOT EXISTS idx_runtime_events_timestamp ON runtime_events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_runtime_events_kind ON runtime_events(kind);

-- Quota telemetry (Codex rate_limits today -- Claude Code is a seam for later)
CREATE TABLE IF NOT EXISTS quota_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  timestamp DATETIME NOT NULL,
  limit_id TEXT NOT NULL,
  used_percent REAL NOT NULL,
  window_minutes INTEGER,
  resets_at DATETIME,

  FOREIGN KEY (source_id) REFERENCES sources(id),
  FOREIGN KEY (instance_id) REFERENCES source_instances(id)
);

CREATE INDEX IF NOT EXISTS idx_quota_snapshots_lookup ON quota_snapshots(source_id, limit_id, timestamp DESC);

-- ============================================================================
-- SHAPE (c): GENERATION — ComfyUI
-- ============================================================================

CREATE TABLE IF NOT EXISTS generation_jobs (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'success', 'error', 'interrupted')),

  first_seen_at DATETIME NOT NULL,
  observed_started_at DATETIME,
  observed_completed_at DATETIME,

  workflow_hash TEXT,
  node_count INTEGER,
  output_count INTEGER,
  details JSON,

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (source_id) REFERENCES sources(id),
  FOREIGN KEY (instance_id) REFERENCES source_instances(id),
  UNIQUE (source_id, instance_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_generation_jobs_first_seen ON generation_jobs(first_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_generation_jobs_status ON generation_jobs(status);

-- ============================================================================
-- BACKGROUND JOBS — repurposed Cron UI (Hermes background work + collector
-- self-observation -- maps onto types/cron.ts CronJobState/RunHistory)
-- ============================================================================

CREATE TABLE IF NOT EXISTS background_jobs (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('inferred', 'collector', 'scheduled')),
  enabled INTEGER NOT NULL DEFAULT 1,
  meta JSON,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (source_id) REFERENCES sources(id)
);

CREATE TABLE IF NOT EXISTS job_runs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  started_at DATETIME NOT NULL,
  ended_at DATETIME,
  status TEXT NOT NULL CHECK (status IN ('success', 'failure', 'cancelled', 'timeout', 'running')),
  duration_ms INTEGER,
  output TEXT,
  error TEXT,
  details JSON,

  FOREIGN KEY (job_id) REFERENCES background_jobs(id)
);

CREATE INDEX IF NOT EXISTS idx_job_runs_job ON job_runs(job_id, started_at DESC);

-- ============================================================================
-- INGEST IDEMPOTENCY — generic dedupe independent of each table's own shape.
-- The collector supplies a stable natural key per event -- a PRIMARY KEY
-- conflict here means "already ingested", regardless of what the entity
-- table's own UNIQUE constraint looks like.
-- ============================================================================

CREATE TABLE IF NOT EXISTS ingest_dedupe (
  source_id TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  natural_key TEXT NOT NULL,
  entity_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (source_id, instance_id, kind, natural_key)
);
`;

/**
 * Split SQL into individual statements for execution.
 * Strips `-- line comments` first so a semicolon inside a comment can't be
 * mistaken for a statement terminator (this bit us once already).
 */
export function getSQLStatements(): string[] {
  const withoutComments = SCHEMA_SQL.split("\n")
    .map((line) => {
      const idx = line.indexOf("--");
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join("\n");

  return withoutComments
    .split(";")
    .map((stmt) => stmt.trim())
    .filter((stmt) => stmt.length > 0);
}
