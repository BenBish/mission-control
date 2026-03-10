/**
 * Database seeder for E2E tests.
 * Seeds realistic test data into the Playwright test database.
 */

import sqlite3 from "sqlite3";
import { open } from "sqlite";
import { getSQLStatements } from "../../src/db/schema.js";
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

export async function seedDatabase(): Promise<void> {
  // Ensure test-data directory exists
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  // Remove existing test DB
  if (fs.existsSync(DB_PATH)) {
    fs.unlinkSync(DB_PATH);
  }
  // Also remove WAL/SHM files
  for (const ext of ["-wal", "-shm"]) {
    const p = DB_PATH + ext;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });

  // Run schema
  const statements = getSQLStatements();
  for (const stmt of statements) {
    await db.exec(stmt);
  }

  // Run migration for profile_id index
  await db.exec(
    "CREATE INDEX IF NOT EXISTS idx_activities_profile_timestamp ON activities(profile_id, timestamp DESC)",
  );
  await db.exec(
    "CREATE INDEX IF NOT EXISTS idx_llm_generations_profile_ts ON llm_generations(profile_id, timestamp DESC)",
  );

  // Seed sessions
  const now = new Date();
  for (let i = 0; i < SESSIONS.length; i++) {
    const startTime = new Date(
      now.getTime() - (SESSIONS.length - i) * 3600_000,
    );
    const endTime =
      i < SESSIONS.length - 1
        ? new Date(startTime.getTime() + 3000_000)
        : null;
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
    const timestamp = new Date(
      now.getTime() - (60 - i) * 60_000,
    ).toISOString();
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
  if (fs.existsSync(DB_PATH)) {
    fs.unlinkSync(DB_PATH);
  }
  for (const ext of ["-wal", "-shm"]) {
    const p = DB_PATH + ext;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}
