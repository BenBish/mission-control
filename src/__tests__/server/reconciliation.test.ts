/**
 * Spend reconciliation API route (BSH-101).
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import express from "express";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Database } from "../../db/database.js";
import { setupRoutes } from "../../server/routes/index.js";

let fixtureDir: string;
let server: ReturnType<ReturnType<typeof express>["listen"]>;
let baseUrl: string;
let db: Database;

beforeAll(async () => {
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-recon-"));
  db = new Database(path.join(fixtureDir, "test.db"));
  await db.initialize();

  const raw = db.raw();
  await raw.run(
    `INSERT OR IGNORE INTO sources (id, name, kind, default_unit) VALUES (?, ?, ?, ?)`,
    "claude-code",
    "Claude Code",
    "agentic",
    "quota",
  );
  await raw.run(
    `INSERT OR IGNORE INTO source_instances (
      id, source_id, machine, collector_kind, status
    ) VALUES (?, ?, ?, ?, ?)`,
    "claude-code@test",
    "claude-code",
    "test",
    "jsonl-push",
    "ok",
  );
  await raw.run(
    `INSERT INTO sessions (
      id, source_id, instance_id, external_id, title, started_at
    ) VALUES (?, ?, ?, ?, ?, ?)`,
    "claude-code:recon",
    "claude-code",
    "claude-code@test",
    "recon",
    "Recon session",
    "2026-08-05T10:00:00.000Z",
  );
  await raw.run(
    `INSERT INTO activities (
      id, source_id, instance_id, session_id, timestamp,
      actor_type, actor_id, action_type, description, status,
      input_tokens, output_tokens, model
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    "act-recon-1",
    "claude-code",
    "claude-code@test",
    "claude-code:recon",
    "2026-08-05T10:05:00.000Z",
    "agent",
    "main",
    "message",
    "hello",
    "success",
    1000,
    200,
    "claude-sonnet-4",
  );
  await raw.run(
    `INSERT INTO provider_usage_daily (
      provider, day, model, input_tokens, output_tokens, cost_usd, request_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    "anthropic",
    "2026-08-05",
    "claude-sonnet-4",
    1000,
    200,
    1.25,
    2,
  );

  const app = express();
  app.use(express.json());
  setupRoutes(app, db);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no listen address");
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  await db.close();
  fs.rmSync(fixtureDir, { recursive: true, force: true });
});

describe("GET /api/consumption/reconciliation", () => {
  test("returns derived report with success contract and options echo", async () => {
    const res = await fetch(
      `${baseUrl}/api/consumption/reconciliation?since=2026-08-05&byok=flag_overlap&providers=anthropic`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      source: string;
      options: {
        includeProviders: string[] | null;
        byokTreatment: string;
      };
      summary: {
        matchedSpendUsd: number;
        coveragePct: number | null;
        providerSpendUsd: number;
      };
      matches: Array<{ classification: string }>;
      meta: { source: string };
    };
    expect(body.success).toBe(true);
    expect(body.source).toBe("reconciliation");
    expect(body.meta.source).toBe("derived-on-read");
    expect(body.options.byokTreatment).toBe("flag_overlap");
    expect(body.options.includeProviders).toEqual(["anthropic"]);
    expect(body.summary.providerSpendUsd).toBe(1.25);
    expect(body.summary.matchedSpendUsd).toBe(1.25);
    expect(body.summary.coveragePct).toBe(100);
    expect(body.matches.some((m) => m.classification === "exact")).toBe(true);
  });
});
