/**
 * Database seeder for E2E tests.
 * Seeds realistic test data into the Playwright test database.
 *
 * Uses the same sqlite3/sqlite packages as the API server to avoid
 * cross-library DB format incompatibilities.
 */

import sqlite3 from "sqlite3";
import { open } from "sqlite";
import path from "path";
import fs from "fs";

const DB_PATH = path.resolve("./test-data/playwright.db");

const AGENTS = ["claude-opus", "claude-sonnet", "claude-haiku"];
const SESSIONS = [
  "session-e2e-001",
  "session-e2e-002",
  "session-e2e-003",
  "session-e2e-004",
  "session-e2e-005",
];
const STATUSES = ["success", "failure", "pending"] as const;
const ACTION_TYPES = [
  "tool_call",
  "llm_request",
  "file_edit",
  "command",
  "event",
];
const TOOL_NAMES = [
  "Read",
  "Edit",
  "Write",
  "Bash",
  "Grep",
  "Glob",
  "Agent",
  null,
];
const MODELS = ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5"];

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomFloat(min: number, max: number): number {
  return Math.round((Math.random() * (max - min) + min) * 10000) / 10000;
}

/** Schema DDL — uses DELETE journal mode (the SQLite default) to avoid
 *  cross-process WAL visibility issues. The API server will switch to WAL
 *  on startup via its own PRAGMA statements. */
const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL DEFAULT 'default',
  session_id TEXT NOT NULL,
  parent_activity_id TEXT,
  timestamp DATETIME NOT NULL,
  completed_at DATETIME,
  duration_ms INTEGER,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_role TEXT,
  actor_session_label TEXT,
  action_type TEXT NOT NULL,
  tool_name TEXT,
  description TEXT NOT NULL,
  details JSON,
  status TEXT NOT NULL,
  result JSON,
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  model TEXT,
  cost_usd REAL,
  tags TEXT,
  references_json JSON,
  metadata JSON,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES sessions(id),
  FOREIGN KEY (parent_activity_id) REFERENCES activities(id)
);

CREATE INDEX IF NOT EXISTS idx_activities_timestamp ON activities(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_activities_session ON activities(session_id);
CREATE INDEX IF NOT EXISTS idx_activities_actor ON activities(actor_id);
CREATE INDEX IF NOT EXISTS idx_activities_status ON activities(status);
CREATE INDEX IF NOT EXISTS idx_activities_tool ON activities(tool_name);
CREATE INDEX IF NOT EXISTS idx_activities_session_actor ON activities(session_id, actor_id);
CREATE INDEX IF NOT EXISTS idx_activities_profile_timestamp ON activities(profile_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL DEFAULT 'default',
  start_time DATETIME NOT NULL,
  end_time DATETIME,
  total_actions INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  total_cost_usd REAL DEFAULT 0.0,
  avg_action_duration_ms REAL DEFAULT 0,
  actors_json JSON,
  top_tools_json JSON,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sessions_start_time ON sessions(start_time DESC);

CREATE TABLE IF NOT EXISTS cost_summaries (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL DEFAULT 'default',
  session_id TEXT NOT NULL,
  actor_id TEXT,
  summary_date DATE NOT NULL,
  action_count INTEGER DEFAULT 0,
  total_cost_usd REAL DEFAULT 0.0,
  total_tokens INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES sessions(id),
  UNIQUE (session_id, actor_id, summary_date)
);

CREATE INDEX IF NOT EXISTS idx_cost_summaries_session ON cost_summaries(session_id);
CREATE INDEX IF NOT EXISTS idx_cost_summaries_date ON cost_summaries(summary_date DESC);

CREATE TABLE IF NOT EXISTS activity_logs (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL,
  stdout TEXT,
  stderr TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (activity_id) REFERENCES activities(id)
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_activity ON activity_logs(activity_id);

CREATE TABLE IF NOT EXISTS llm_generations (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL DEFAULT 'default',
  session_log_file TEXT NOT NULL,
  session_log_msg_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  timestamp DATETIME NOT NULL,
  model TEXT NOT NULL,
  provider TEXT,
  stop_reason TEXT,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cache_read_tokens INTEGER DEFAULT 0,
  cache_write_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  cost_input REAL DEFAULT 0,
  cost_output REAL DEFAULT 0,
  cost_cache_read REAL DEFAULT 0,
  cost_total REAL DEFAULT 0,
  linked_activity_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(session_log_file, session_log_msg_id)
);

CREATE INDEX IF NOT EXISTS idx_llm_generations_timestamp ON llm_generations(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_llm_generations_agent ON llm_generations(agent_id);
CREATE INDEX IF NOT EXISTS idx_llm_generations_model ON llm_generations(model);
CREATE INDEX IF NOT EXISTS idx_llm_generations_linked ON llm_generations(linked_activity_id);
CREATE INDEX IF NOT EXISTS idx_llm_generations_profile_ts ON llm_generations(profile_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS scan_state (
  file_path TEXT NOT NULL,
  profile_id TEXT NOT NULL DEFAULT 'default',
  last_offset INTEGER DEFAULT 0,
  last_scanned_at DATETIME,
  file_size INTEGER DEFAULT 0,
  PRIMARY KEY (file_path, profile_id)
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`;

/** Split multi-statement SQL into individual statements for exec. */
function splitStatements(sql: string): string[] {
  return sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Create agent workspace files in the E2E test HOME so the API can discover
 * SOUL.md and workspace files for the seeded agents.
 */
function seedAgentFiles(): void {
  const home = process.env.HOME || "/tmp/mc-e2e-home";
  // Use .openclaw (not .openclaw-team) because the default profile maps to ~/.openclaw
  const teamDir = path.join(home, ".openclaw");

  for (const agentId of AGENTS) {
    const agentDir = path.join(teamDir, "agents", agentId);
    fs.mkdirSync(agentDir, { recursive: true });

    fs.writeFileSync(
      path.join(agentDir, "SOUL.md"),
      `# SOUL.md — ${agentId}

You are the **${agentId}** — you assist with software engineering tasks.

## Role
AI Software Engineer

Model: openrouter/anthropic/${agentId}

GIT_AUTHOR_NAME = ${agentId}
GIT_AUTHOR_EMAIL = ${agentId}@test.local
`,
    );

    fs.writeFileSync(
      path.join(agentDir, "AGENTS.md"),
      `# AGENTS.md

GIT_AUTHOR_NAME = ${agentId}
GIT_AUTHOR_EMAIL = ${agentId}@test.local
`,
    );

    fs.writeFileSync(
      path.join(agentDir, "config.json"),
      JSON.stringify({ agent: agentId, version: 1 }, null, 2),
    );
  }
}

export async function seedDatabase(): Promise<void> {
  // Ensure test-data directory exists
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  // Seed agent workspace files for SOUL.md and config tab tests
  seedAgentFiles();

  // Remove existing test DB
  for (const ext of ["", "-wal", "-shm"]) {
    const p = DB_PATH + ext;
    if (fs.existsSync(p)) {
      console.log(`[seedDatabase] removing ${p}`);
      fs.unlinkSync(p);
    }
  }

  // Use the same sqlite3/sqlite packages as the API server
  const db = await open({
    filename: DB_PATH,
    driver: sqlite3.Database,
  });

  // Create schema
  for (const stmt of splitStatements(SCHEMA_DDL)) {
    await db.exec(stmt);
  }

  // Mark migration 001 as already applied so the API won't backfill profile_id
  await db.run(
    "INSERT INTO schema_migrations (version, name) VALUES (?, ?)",
    "001",
    "add-profile-id",
  );

  // Seed sessions
  const now = new Date();
  for (let i = 0; i < SESSIONS.length; i++) {
    const startTime = new Date(
      now.getTime() - (SESSIONS.length - i) * 3600_000,
    );
    const endTime =
      i < SESSIONS.length - 1 ? new Date(startTime.getTime() + 3000_000) : null;
    await db.run(
      "INSERT INTO sessions (id, profile_id, start_time, end_time) VALUES (?, ?, ?, ?)",
      SESSIONS[i],
      "default",
      startTime.toISOString(),
      endTime?.toISOString() ?? null,
    );
  }

  // Seed 60 activities across sessions
  for (let i = 0; i < 60; i++) {
    const sessionId = randomItem(SESSIONS);
    const agentId = randomItem(AGENTS);
    const status = randomItem([...STATUSES]);
    const actionType = randomItem(ACTION_TYPES);
    const toolName = randomItem(TOOL_NAMES);
    const model = randomItem(MODELS);
    const timestamp = new Date(now.getTime() - (60 - i) * 60_000).toISOString();
    const inputTokens = Math.floor(Math.random() * 5000) + 100;
    const outputTokens = Math.floor(Math.random() * 2000) + 50;
    const totalTokens = inputTokens + outputTokens;
    const costUsd = randomFloat(0.001, 0.15);
    const durationMs =
      status !== "pending" ? Math.floor(Math.random() * 10000) + 200 : null;

    await db.run(
      `INSERT INTO activities (
        id, profile_id, session_id, timestamp, actor_type, actor_id,
        action_type, tool_name, description, status,
        input_tokens, output_tokens, total_tokens, model, cost_usd,
        duration_ms, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      `activity-e2e-${String(i).padStart(3, "0")}`,
      "default",
      sessionId,
      timestamp,
      "agent",
      agentId,
      actionType,
      toolName,
      `E2E test activity ${i}: ${actionType}${toolName ? ` using ${toolName}` : ""}`,
      status,
      inputTokens,
      outputTokens,
      totalTokens,
      model,
      costUsd,
      durationMs,
      status !== "pending"
        ? new Date(
            new Date(timestamp).getTime() + (durationMs ?? 0),
          ).toISOString()
        : null,
    );
  }

  // Seed LLM generations
  for (let i = 0; i < 30; i++) {
    const agentId = randomItem(AGENTS);
    const model = randomItem(MODELS);
    const timestamp = new Date(
      now.getTime() - (30 - i) * 120_000,
    ).toISOString();
    const inputTokens = Math.floor(Math.random() * 8000) + 500;
    const outputTokens = Math.floor(Math.random() * 3000) + 100;
    const cacheReadTokens = Math.floor(Math.random() * 2000);
    const cacheWriteTokens = Math.floor(Math.random() * 1000);
    const totalTokens =
      inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;
    const costInput = randomFloat(0.001, 0.05);
    const costOutput = randomFloat(0.002, 0.08);
    const costCacheRead = randomFloat(0, 0.01);
    const costTotal = costInput + costOutput + costCacheRead;

    await db.run(
      `INSERT INTO llm_generations (
        id, profile_id, session_log_file, session_log_msg_id, agent_id, timestamp,
        model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
        total_tokens, cost_input, cost_output, cost_cache_read, cost_total
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      `gen-e2e-${String(i).padStart(3, "0")}`,
      "default",
      `test-session-${i % 5}.jsonl`,
      `msg-${i}`,
      agentId,
      timestamp,
      model,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      totalTokens,
      costInput,
      costOutput,
      costCacheRead,
      costTotal,
    );
  }

  await db.close();
}

export async function cleanDatabase(): Promise<void> {
  console.log(
    `[cleanDatabase] called from:`,
    new Error().stack?.split("\n").slice(1, 4).join(" → "),
  );
  for (const ext of ["", "-wal", "-shm"]) {
    const p = DB_PATH + ext;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}
