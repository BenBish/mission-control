/**
 * Database seeder for E2E tests.
 * Seeds realistic test data into the Playwright test database.
 *
 * Reuses the real Database class (schema + migrations + source seeding) so
 * the seeded DB is never allowed to drift from what the actual server
 * creates on boot — only session/activity/quota_snapshot test fixtures are
 * seeded here on top.
 */

import path from "path";
import fs from "fs";
import { Database } from "../../src/db/database.js";
import type { Database as SqliteDatabase } from "sqlite";

const DB_PATH = path.resolve("./test-data/playwright.db");

export const TEST_SESSIONS = {
  claudeCode: [
    "session-e2e-cc-001",
    "session-e2e-cc-002",
    "session-e2e-cc-003",
  ],
  codex: ["session-e2e-cx-001", "session-e2e-cx-002"],
};

const ACTOR_TYPES = ["user", "agent", "subagent", "system"] as const;
const ACTION_TYPES = [
  "tool_call",
  "delegation",
  "api_call",
  "decision",
  "message",
  "event",
  "user_request",
  "agent_spawn",
] as const;
const STATUSES = ["success", "failure", "pending"] as const;
const TOOL_NAMES = ["Read", "Edit", "Write", "Bash", "Grep", "Glob", null];
const CLAUDE_MODELS = [
  "claude-opus-4-8",
  "claude-sonnet-5",
  "claude-haiku-4-5",
];
const CODEX_MODELS = ["gpt-5-codex"];

function randomItem<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

interface SessionSeed {
  id: string;
  sourceId: string;
  instanceId: string;
  externalId: string;
}

async function seedSessionsAndActivities(db: SqliteDatabase): Promise<void> {
  const now = new Date();

  const sessions: SessionSeed[] = [
    ...TEST_SESSIONS.claudeCode.map((externalId) => ({
      id: `claude-code:${externalId}`,
      sourceId: "claude-code",
      instanceId: "claude-code@arch-desktop",
      externalId,
    })),
    ...TEST_SESSIONS.codex.map((externalId) => ({
      id: `codex:${externalId}`,
      sourceId: "codex",
      instanceId: "codex@arch-desktop",
      externalId,
    })),
  ];

  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i];
    const startedAt = new Date(
      now.getTime() - (sessions.length - i) * 3_600_000,
    );
    const endedAt =
      i < sessions.length - 1
        ? new Date(startedAt.getTime() + 3_000_000)
        : null;

    await db.run(
      `INSERT INTO sessions (
        id, source_id, instance_id, external_id, cwd, git_branch, title,
        started_at, ended_at, turn_count, tool_call_count, failure_count,
        input_tokens, output_tokens, cache_read_tokens, cache_write_tokens
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      s.id,
      s.sourceId,
      s.instanceId,
      s.externalId,
      "/home/e2e/test-project",
      "main",
      `E2E test session ${s.externalId}`,
      startedAt.toISOString(),
      endedAt?.toISOString() ?? null,
      10,
      5,
      1,
      5000,
      2000,
      1000,
      500,
    );
  }

  // ~60 activities spread across sessions, including a handful of
  // subagent-actor activities with real parent linkage so
  // session-timeline.spec.ts has sidechain data to assert against.
  let lastActivityId: string | null = null;
  for (let i = 0; i < 60; i++) {
    const session = randomItem(sessions);
    const isCodex = session.sourceId === "codex";
    const actorType =
      i % 11 === 0
        ? "subagent"
        : randomItem(ACTOR_TYPES.filter((t) => t !== "subagent"));
    const status = randomItem(STATUSES);
    const actionType = randomItem(ACTION_TYPES);
    const toolName = randomItem(TOOL_NAMES);
    const model = randomItem(isCodex ? CODEX_MODELS : CLAUDE_MODELS);
    const timestamp = new Date(now.getTime() - (60 - i) * 60_000);
    const inputTokens = Math.floor(Math.random() * 5000) + 100;
    const outputTokens = Math.floor(Math.random() * 2000) + 50;
    const totalTokens = inputTokens + outputTokens;
    const durationMs =
      status !== "pending" ? Math.floor(Math.random() * 10000) + 200 : null;
    const activityId = `activity-e2e-${String(i).padStart(3, "0")}`;
    const externalId = `ext-${i}`;
    // Every 11th activity is a subagent delegated from the previous one.
    const parentActivityId = actorType === "subagent" ? lastActivityId : null;

    await db.run(
      `INSERT INTO activities (
        id, source_id, instance_id, session_id, external_id,
        parent_activity_id, timestamp, actor_type, actor_id,
        action_type, tool_name, description, status,
        input_tokens, output_tokens, total_tokens, model,
        duration_ms, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      activityId,
      session.sourceId,
      session.instanceId,
      session.id,
      externalId,
      parentActivityId,
      timestamp.toISOString(),
      actorType,
      actorType === "user" ? "user" : "assistant",
      actionType,
      toolName,
      `E2E test activity ${i}: ${actionType}${toolName ? ` using ${toolName}` : ""}`,
      status,
      inputTokens,
      outputTokens,
      totalTokens,
      model,
      durationMs,
      status !== "pending"
        ? new Date(timestamp.getTime() + (durationMs ?? 0)).toISOString()
        : null,
    );
    lastActivityId = activityId;
  }

  // A couple of real Codex quota_snapshot rows.
  const codexSession = sessions.find((s) => s.sourceId === "codex")!;
  await db.run(
    `INSERT INTO quota_snapshots (source_id, instance_id, timestamp, limit_id, used_percent, window_minutes, resets_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    "codex",
    codexSession.instanceId,
    now.toISOString(),
    "codex:primary",
    12.5,
    300,
    new Date(now.getTime() + 300 * 60_000).toISOString(),
  );
  await db.run(
    `INSERT INTO quota_snapshots (source_id, instance_id, timestamp, limit_id, used_percent, window_minutes, resets_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    "codex",
    codexSession.instanceId,
    now.toISOString(),
    "codex:secondary",
    34.0,
    10080,
    new Date(now.getTime() + 10080 * 60_000).toISOString(),
  );

  // A couple of background_jobs with run history — Jobs page is read-only,
  // this is collector-observed data, not something a test can trigger.
  await db.run(
    `INSERT INTO background_jobs (id, source_id, name, kind, enabled)
     VALUES (?, ?, ?, ?, 1)`,
    "collector:claude-code@arch-desktop",
    "claude-code",
    "Claude Code collector",
    "collector",
  );
  await db.run(
    `INSERT INTO background_jobs (id, source_id, name, kind, enabled)
     VALUES (?, ?, ?, ?, 1)`,
    "hermes:compression",
    "hermes",
    "Hermes context compression",
    "inferred",
  );

  const jobRuns: Array<{
    id: string;
    jobId: string;
    startedAt: Date;
    status: "success" | "failure";
    durationMs: number;
  }> = [
    {
      id: "run-e2e-001",
      jobId: "collector:claude-code@arch-desktop",
      startedAt: new Date(now.getTime() - 30_000),
      status: "success",
      durationMs: 420,
    },
    {
      id: "run-e2e-002",
      jobId: "collector:claude-code@arch-desktop",
      startedAt: new Date(now.getTime() - 90_000),
      status: "success",
      durationMs: 380,
    },
    {
      id: "run-e2e-003",
      jobId: "hermes:compression",
      startedAt: new Date(now.getTime() - 60_000),
      status: "failure",
      durationMs: 1200,
    },
  ];
  for (const run of jobRuns) {
    await db.run(
      `INSERT INTO job_runs (id, job_id, started_at, ended_at, status, duration_ms, error)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      run.id,
      run.jobId,
      run.startedAt.toISOString(),
      new Date(run.startedAt.getTime() + run.durationMs).toISOString(),
      run.status,
      run.durationMs,
      run.status === "failure" ? "context window exceeded" : null,
    );
  }
}

export async function seedDatabase(): Promise<void> {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  for (const ext of ["", "-wal", "-shm"]) {
    const p = DB_PATH + ext;
    if (fs.existsSync(p)) {
      console.log(`[seedDatabase] removing ${p}`);
      fs.unlinkSync(p);
    }
  }

  const db = new Database(DB_PATH);
  await db.initialize(); // creates schema, runs migrations, seeds sources
  await seedSessionsAndActivities(db.raw());
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
