/**
 * Migration 001 — normalize Grok cache-inclusive input tokens.
 * Verifies old-shape rows are fixed and already-normalized rows are left alone.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  Database,
  normalizeGrokCacheInclusiveInputTokens,
} from "../../db/database.js";

let fixtureDir: string;
let db: Database;

const GROK_INSTANCE = "grok@arch-desktop";
const CLAUDE_INSTANCE = "claude-code@arch-desktop";

beforeEach(async () => {
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-grok-mig-"));
  db = new Database(path.join(fixtureDir, "test.db"));
  await db.initialize();
});

afterEach(async () => {
  await db.close();
  fs.rmSync(fixtureDir, { recursive: true, force: true });
});

async function seedSession(opts: {
  sourceId: string;
  instanceId: string;
  externalId: string;
  input: number;
  output: number;
  cache: number;
}) {
  const id = `${opts.sourceId}:${opts.externalId}`;
  await db.raw().run(
    `INSERT INTO sessions (
       id, source_id, instance_id, external_id, started_at,
       input_tokens, output_tokens, cache_read_tokens
     ) VALUES (?, ?, ?, ?, '2026-07-16T00:00:00.000Z', ?, ?, ?)`,
    id,
    opts.sourceId,
    opts.instanceId,
    opts.externalId,
    opts.input,
    opts.output,
    opts.cache,
  );
  return id;
}

async function seedActivity(opts: {
  id: string;
  sourceId: string;
  instanceId: string;
  sessionId: string;
  externalId: string;
  input: number;
  output: number;
  cache: number;
  total: number | null;
}) {
  await db.raw().run(
    `INSERT INTO activities (
       id, source_id, instance_id, session_id, external_id,
       timestamp, actor_type, actor_id, action_type, description, status,
       input_tokens, output_tokens, total_tokens, cache_read_tokens
     ) VALUES (?, ?, ?, ?, ?, '2026-07-16T00:00:00.000Z',
               'system', 'usage', 'event', 'Usage update', 'success',
               ?, ?, ?, ?)`,
    opts.id,
    opts.sourceId,
    opts.instanceId,
    opts.sessionId,
    opts.externalId,
    opts.input,
    opts.output,
    opts.total,
    opts.cache,
  );
}

describe("normalizeGrokCacheInclusiveInputTokens", () => {
  test("subtracts cache from old-shape activities (input + output ≈ total)", async () => {
    const sessionId = await seedSession({
      sourceId: "grok",
      instanceId: GROK_INSTANCE,
      externalId: "sess-old",
      input: 1000,
      output: 50,
      cache: 800,
    });
    // Old shape: inclusive input 1000, cache 800, output 50, total 1050
    await seedActivity({
      id: "act-old",
      sourceId: "grok",
      instanceId: GROK_INSTANCE,
      sessionId,
      externalId: "usage-old",
      input: 1000,
      output: 50,
      cache: 800,
      total: 1050,
    });

    await normalizeGrokCacheInclusiveInputTokens(db.raw());

    const activity = await db.raw().get<{
      input_tokens: number;
      cache_read_tokens: number;
      total_tokens: number;
    }>("SELECT input_tokens, cache_read_tokens, total_tokens FROM activities WHERE id = ?", "act-old");
    expect(activity).toEqual({
      input_tokens: 200,
      cache_read_tokens: 800,
      total_tokens: 1050,
    });

    const session = await db.raw().get<{
      input_tokens: number;
      output_tokens: number;
      cache_read_tokens: number;
    }>("SELECT input_tokens, output_tokens, cache_read_tokens FROM sessions WHERE id = ?", sessionId);
    // Session rebuilt from activity sums after the activity fix
    expect(session).toEqual({
      input_tokens: 200,
      output_tokens: 50,
      cache_read_tokens: 800,
    });
  });

  test("leaves already-normalized exclusive rows alone (including low-cache)", async () => {
    const sessionId = await seedSession({
      sourceId: "grok",
      instanceId: GROK_INSTANCE,
      externalId: "sess-norm",
      input: 1000,
      output: 100,
      cache: 900,
    });
    // New shape after parser fix: exclusive input, total still full
    // High cache: input 200 + output 50 ≠ total 1050
    await seedActivity({
      id: "act-high-cache",
      sourceId: "grok",
      instanceId: GROK_INSTANCE,
      sessionId,
      externalId: "usage-high",
      input: 200,
      output: 50,
      cache: 800,
      total: 1050,
    });
    // Low cache: exclusive 900 >= cache 100 — old predicate would double-subtract
    await seedActivity({
      id: "act-low-cache",
      sourceId: "grok",
      instanceId: GROK_INSTANCE,
      sessionId,
      externalId: "usage-low",
      input: 900,
      output: 50,
      cache: 100,
      total: 1050,
    });

    await normalizeGrokCacheInclusiveInputTokens(db.raw());

    const high = await db.raw().get<{
      input_tokens: number;
    }>("SELECT input_tokens FROM activities WHERE id = ?", "act-high-cache");
    const low = await db.raw().get<{
      input_tokens: number;
    }>("SELECT input_tokens FROM activities WHERE id = ?", "act-low-cache");
    expect(high?.input_tokens).toBe(200);
    expect(low?.input_tokens).toBe(900);

    const session = await db.raw().get<{
      input_tokens: number;
      output_tokens: number;
      cache_read_tokens: number;
    }>("SELECT input_tokens, output_tokens, cache_read_tokens FROM sessions WHERE id = ?", sessionId);
    expect(session).toEqual({
      input_tokens: 1100,
      output_tokens: 100,
      cache_read_tokens: 900,
    });
  });

  test("does not touch non-grok sources", async () => {
    const sessionId = await seedSession({
      sourceId: "claude-code",
      instanceId: CLAUDE_INSTANCE,
      externalId: "sess-claude",
      input: 1000,
      output: 50,
      cache: 800,
    });
    await seedActivity({
      id: "act-claude",
      sourceId: "claude-code",
      instanceId: CLAUDE_INSTANCE,
      sessionId,
      externalId: "usage-claude",
      input: 1000,
      output: 50,
      cache: 800,
      total: 1050,
    });

    await normalizeGrokCacheInclusiveInputTokens(db.raw());

    const activity = await db.raw().get<{
      input_tokens: number;
    }>("SELECT input_tokens FROM activities WHERE id = ?", "act-claude");
    const session = await db.raw().get<{
      input_tokens: number;
    }>("SELECT input_tokens FROM sessions WHERE id = ?", sessionId);
    expect(activity?.input_tokens).toBe(1000);
    expect(session?.input_tokens).toBe(1000);
  });

  test("is safe to re-run (idempotent for activities)", async () => {
    const sessionId = await seedSession({
      sourceId: "grok",
      instanceId: GROK_INSTANCE,
      externalId: "sess-idem",
      input: 1000,
      output: 50,
      cache: 800,
    });
    await seedActivity({
      id: "act-idem",
      sourceId: "grok",
      instanceId: GROK_INSTANCE,
      sessionId,
      externalId: "usage-idem",
      input: 1000,
      output: 50,
      cache: 800,
      total: 1050,
    });

    await normalizeGrokCacheInclusiveInputTokens(db.raw());
    await normalizeGrokCacheInclusiveInputTokens(db.raw());

    const activity = await db.raw().get<{
      input_tokens: number;
    }>("SELECT input_tokens FROM activities WHERE id = ?", "act-idem");
    expect(activity?.input_tokens).toBe(200);
  });
});
