/**
 * BSH-100: redaction, production auth policy, roles, list sanitization.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import express from "express";
import * as http from "http";
import { Database } from "../../db/database.js";
import { setupRoutes } from "../../server/routes/index.js";
import {
  resolveAuthConfig,
  setupAuthRoutes,
  authMiddleware,
  signToken,
  type AuthConfig,
} from "../../server/auth.js";
import {
  resolvePrivacyPolicy,
  checkProductionAuthPolicy,
} from "../../server/privacy/policy.js";
import {
  redactSecretsInString,
  redactPathsInString,
  redactActivityPayload,
  redactText,
  REDACTED,
  REDACTED_PATH,
  sanitizeSessionForClient,
  sanitizeActivityForClient,
} from "../../server/privacy/redact.js";
import {
  runDataClassRetention,
  purgeSensitiveStoredFields,
} from "../../db/queries/retention.js";
import { processIngestBatch } from "../../server/services/ingest-service.js";

const TEST_DB = "./test-data/test-privacy.db";

async function request(
  server: http.Server,
  method: string,
  pathName: string,
  options: {
    body?: Record<string, unknown>;
    headers?: Record<string, string>;
    cookie?: string;
  } = {},
): Promise<{ status: number; body: any }> {
  const address = server.address() as { port: number };
  const url = `http://127.0.0.1:${address.port}${pathName}`;
  const headers: Record<string, string> = { ...options.headers };
  if (options.body) headers["Content-Type"] = "application/json";
  if (options.cookie) headers["Cookie"] = options.cookie;
  const res = await fetch(url, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

function makeAuthConfig(overrides: Partial<AuthConfig> = {}): AuthConfig {
  return {
    enabled: true,
    username: "admin",
    passwordHash: "test-owner-pass",
    viewerUsername: "viewer",
    viewerPasswordHash: "test-viewer-pass",
    jwtSecret: new TextEncoder().encode("test-jwt-secret-for-privacy"),
    apiKey: "test-api-key",
    sessionTtl: 3600,
    secureCookie: false,
    ...overrides,
  };
}

describe("redaction patterns", () => {
  test("redacts API keys and bearer tokens", () => {
    const raw =
      "use sk-abcdefghijklmnopqrstuvwxyz123456 and Bearer eyJhbGciOiJIUzI1NiJ9.abc.def";
    const out = redactSecretsInString(raw);
    expect(out).toContain(REDACTED);
    expect(out).not.toContain("sk-abcdefghijklmnopqrstuvwxyz123456");
    expect(out.toLowerCase()).not.toContain("bearer eyj");
  });

  test("redacts absolute home paths without eating unrelated words", () => {
    const raw = "opened /home/ben/Dev/mission-control/src/main.ts ok";
    const out = redactPathsInString(raw);
    expect(out).toContain(REDACTED_PATH);
    expect(out).not.toContain("/home/ben");
    expect(out).toContain("ok");
  });

  test("standard mode truncates tool payloads but keeps short description", () => {
    const policy = resolvePrivacyPolicy({
      MC_REDACTION_MODE: "standard",
    } as NodeJS.ProcessEnv);
    const redacted = redactActivityPayload(
      {
        sessionExternalId: "s1",
        timestamp: new Date().toISOString(),
        actorType: "agent",
        actorId: "assistant",
        actionType: "tool_call",
        toolName: "Bash",
        description: "Bash",
        status: "success",
        details: {
          arguments: JSON.stringify({
            command: "cat /home/ben/secret.env",
            api_key: "sk-abcdefghijklmnopqrstuvwxyz123456",
          }),
        },
        result: {
          stdout: "password=supersecretvalue123\n" + "x".repeat(500),
        },
      },
      policy,
    );
    const details = redacted.details as Record<string, unknown>;
    const args = String(details.arguments ?? "");
    expect(args).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
    expect(args.length).toBeLessThan(400);
    expect(redacted.description).toBe("Bash");
  });

  test("strict mode truncates user prompts", () => {
    const policy = resolvePrivacyPolicy({
      MC_REDACTION_MODE: "strict",
    } as NodeJS.ProcessEnv);
    const long = "Please review this design: " + "word ".repeat(80);
    const redacted = redactActivityPayload(
      {
        sessionExternalId: "s1",
        timestamp: new Date().toISOString(),
        actorType: "user",
        actorId: "user",
        actionType: "user_request",
        description: long,
        status: "success",
      },
      policy,
    );
    expect(redacted.description.length).toBeLessThan(long.length);
    expect(redacted.description).toContain("[truncated]");
  });

  test("off mode is a no-op", () => {
    const policy = resolvePrivacyPolicy({
      MC_REDACTION_MODE: "off",
    } as NodeJS.ProcessEnv);
    const payload = {
      sessionExternalId: "s1",
      timestamp: new Date().toISOString(),
      actorType: "user" as const,
      actorId: "user",
      actionType: "user_request" as const,
      description: "sk-abcdefghijklmnopqrstuvwxyz123456",
      status: "success",
    };
    expect(redactActivityPayload(payload, policy)).toEqual(payload);
  });

  test("list sanitizers hide cwd and activity details", () => {
    const session = sanitizeSessionForClient(
      {
        sessionId: "1",
        cwd: "/home/ben/Dev/mission-control",
      },
      { includeSensitive: false, hideRawCwd: true },
    );
    expect(session.cwd).toBeUndefined();
    expect(session.project).toBe("mission-control");

    const activity = sanitizeActivityForClient(
      {
        id: "a1",
        description: "hi",
        details: { secret: true },
        result: { stdout: "x" },
      },
      { includeSensitive: false, hideRawCwd: true },
    );
    expect(activity.details).toBeUndefined();
    expect(activity.result).toBeUndefined();
    expect(activity.sensitiveFieldsOmitted).toBe(true);
  });
});

describe("production auth policy", () => {
  test("warns when production + auth disabled", () => {
    const policy = resolvePrivacyPolicy({
      NODE_ENV: "production",
      MC_REQUIRE_AUTH_IN_PRODUCTION: "false",
    } as NodeJS.ProcessEnv);
    const result = checkProductionAuthPolicy(policy, false);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warning).toMatch(/SECURITY WARNING/i);
  });

  test("refuses when require-auth-in-production is set", () => {
    const policy = resolvePrivacyPolicy({
      NODE_ENV: "production",
      MC_REQUIRE_AUTH_IN_PRODUCTION: "true",
    } as NodeJS.ProcessEnv);
    const result = checkProductionAuthPolicy(policy, false);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Refusing to start/);
  });

  test("ok when auth enabled in production", () => {
    const policy = resolvePrivacyPolicy({
      NODE_ENV: "production",
      MC_REQUIRE_AUTH_IN_PRODUCTION: "true",
    } as NodeJS.ProcessEnv);
    expect(checkProductionAuthPolicy(policy, true).ok).toBe(true);
  });
});

describe("roles and API field gating", () => {
  let db: Database;
  let server: http.Server;
  let authConfig: AuthConfig;
  let fixtureDir: string;

  beforeEach(async () => {
    fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-privacy-"));
    const dbPath = path.join(fixtureDir, "test.db");
    db = new Database(dbPath);
    await db.initialize();
    authConfig = makeAuthConfig();

    // Seed a session + activity with sensitive fields (use seeded instance ids)
    const instanceId = "claude-code@arch-desktop";
    await db.raw().run(
      `INSERT INTO sessions (id, source_id, instance_id, external_id, cwd, started_at)
       VALUES ('sess-1', 'claude-code', ?, 'ext-1', '/home/ben/Dev/secret-project', datetime('now'))`,
      instanceId,
    );
    await db.raw().run(
      `INSERT INTO activities (
         id, source_id, instance_id, session_id, timestamp, actor_type, actor_id,
         action_type, description, details, status, result
       ) VALUES (
         'act-1', 'claude-code', ?, 'sess-1', datetime('now'), 'user', 'user',
         'user_request', 'secret prompt text', '{"token":"sk-abc"}', 'success', '{"stdout":"leak"}'
       )`,
      instanceId,
    );

    const app = express();
    app.use(express.json());
    setupAuthRoutes(app, authConfig);
    app.use(authMiddleware(authConfig));
    setupRoutes(app, db, authConfig);
    server = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await db.close();
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  });

  test("viewer cannot call purge endpoints", async () => {
    const token = await signToken(authConfig, "viewer", "viewer");
    const res = await request(server, "POST", "/api/privacy/purge-sensitive", {
      cookie: `mc_session=${token}`,
      body: {},
    });
    expect(res.status).toBe(403);
  });

  test("owner can purge sensitive fields", async () => {
    const token = await signToken(authConfig, "admin", "owner");
    const res = await request(server, "POST", "/api/privacy/purge-sensitive", {
      cookie: `mc_session=${token}`,
      body: { strict: false },
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const row = await db.raw().get<{
      details: string | null;
    }>(`SELECT details FROM activities WHERE id = 'act-1'`);
    expect(row?.details).toBeNull();
  });

  test("list sessions never returns raw cwd", async () => {
    const token = await signToken(authConfig, "admin", "owner");
    const res = await request(server, "GET", "/api/sessions", {
      cookie: `mc_session=${token}`,
    });
    expect(res.status).toBe(200);
    const sessions = res.body.sessions as Array<{
      cwd?: string;
      project?: string;
    }>;
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions[0].cwd).toBeUndefined();
    expect(sessions[0].project).toBe("secret-project");
  });

  test("owner session detail includes raw cwd; viewer does not", async () => {
    const ownerToken = await signToken(authConfig, "admin", "owner");
    const ownerRes = await request(server, "GET", "/api/sessions/sess-1", {
      cookie: `mc_session=${ownerToken}`,
    });
    expect(ownerRes.status).toBe(200);
    expect(ownerRes.body.session.cwd).toBe("/home/ben/Dev/secret-project");
    expect(ownerRes.body.session.project).toBe("secret-project");

    const viewerToken = await signToken(authConfig, "viewer", "viewer");
    const viewerRes = await request(server, "GET", "/api/sessions/sess-1", {
      cookie: `mc_session=${viewerToken}`,
    });
    expect(viewerRes.status).toBe(200);
    expect(viewerRes.body.session.cwd).toBeUndefined();
    expect(viewerRes.body.session.project).toBe("secret-project");
  });

  test("list activities omit details/result; owner detail includes them", async () => {
    const token = await signToken(authConfig, "admin", "owner");
    const list = await request(server, "GET", "/api/activities", {
      cookie: `mc_session=${token}`,
    });
    expect(list.status).toBe(200);
    expect(list.body.activities[0].details).toBeUndefined();
    expect(list.body.activities[0].result).toBeUndefined();

    const detail = await request(server, "GET", "/api/activities/act-1", {
      cookie: `mc_session=${token}`,
    });
    expect(detail.status).toBe(200);
    expect(detail.body.activity.details).toBeTruthy();

    const viewerToken = await signToken(authConfig, "viewer", "viewer");
    const viewerDetail = await request(server, "GET", "/api/activities/act-1", {
      cookie: `mc_session=${viewerToken}`,
    });
    expect(viewerDetail.status).toBe(200);
    expect(viewerDetail.body.activity.details).toBeUndefined();
    expect(viewerDetail.body.activity.sensitiveFieldsOmitted).toBe(true);
  });

  test("health reports security posture without secrets", async () => {
    const res = await request(server, "GET", "/api/health");
    // health is public even with auth on
    expect(res.status).toBe(200);
    expect(res.body.security).toBeDefined();
    expect(res.body.security.authEnabled).toBe(true);
    expect(res.body.security.redactionMode).toBeDefined();
    expect(JSON.stringify(res.body)).not.toMatch(/password|jwt|hash/i);
  });

  test("viewer cannot mutate provider budget", async () => {
    const token = await signToken(authConfig, "viewer", "viewer");
    const res = await request(server, "PUT", "/api/providers/budget", {
      cookie: `mc_session=${token}`,
      body: { monthlyBudgetUsd: 10 },
    });
    expect(res.status).toBe(403);
  });
});

describe("ingest-time redaction", () => {
  let db: Database;
  let fixtureDir: string;
  let prevMode: string | undefined;

  beforeEach(async () => {
    prevMode = process.env.MC_REDACTION_MODE;
    process.env.MC_REDACTION_MODE = "standard";
    fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-ingest-redact-"));
    db = new Database(path.join(fixtureDir, "test.db"));
    await db.initialize();
  });

  afterEach(async () => {
    if (prevMode === undefined) delete process.env.MC_REDACTION_MODE;
    else process.env.MC_REDACTION_MODE = prevMode;
    await db.close();
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  });

  test("processIngestBatch redacts secrets in activity description", async () => {
    const ack = await processIngestBatch(db.raw(), {
      sourceId: "claude-code",
      instanceId: "claude-code@arch-desktop",
      events: [
        {
          kind: "activity",
          naturalKey: "k1",
          payload: {
            sessionExternalId: "ext-session",
            timestamp: new Date().toISOString(),
            actorType: "user",
            actorId: "user",
            actionType: "user_request",
            description:
              "my key is sk-abcdefghijklmnopqrstuvwxyz123456 please use it",
            status: "success",
            details: {
              arguments: "cat /home/ben/Dev/secrets.txt",
            },
          },
        },
      ],
    });
    expect(ack.accepted + ack.rejected.length).toBeGreaterThan(0);
    if (ack.rejected.length) {
      throw new Error(`ingest rejected: ${JSON.stringify(ack.rejected)}`);
    }
    expect(ack.accepted).toBe(1);
    const row = await db.raw().get<{
      description: string;
      details: string;
    }>(`SELECT description, details FROM activities LIMIT 1`);
    expect(row).toBeTruthy();
    expect(row!.description).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
    expect(row!.description).toContain(REDACTED);
    expect(row!.details).not.toContain("/home/ben");
  });
});

describe("data-class retention", () => {
  let db: Database;
  let fixtureDir: string;

  beforeEach(async () => {
    fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-ret-class-"));
    db = new Database(path.join(fixtureDir, "test.db"));
    await db.initialize();
  });

  afterEach(async () => {
    await db.close();
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  });

  test("deletes old activities past retention window", async () => {
    const old = new Date(Date.now() - 200 * 24 * 3600_000).toISOString();
    const recent = new Date().toISOString();
    const instanceId = "claude-code@arch-desktop";
    await db.raw().run(
      `INSERT INTO sessions (id, source_id, instance_id, external_id, started_at, ended_at)
       VALUES ('s-old', 'claude-code', ?, 'e-old', ?, ?)`,
      instanceId,
      old,
      old,
    );
    await db.raw().run(
      `INSERT INTO activities (
         id, source_id, instance_id, session_id, timestamp, actor_type, actor_id,
         action_type, description, status
       ) VALUES (
         'a-old', 'claude-code', ?, 's-old', ?, 'user', 'user',
         'message', 'old', 'success'
       )`,
      instanceId,
      old,
    );
    await db.raw().run(
      `INSERT INTO sessions (id, source_id, instance_id, external_id, started_at)
       VALUES ('s-new', 'claude-code', ?, 'e-new', ?)`,
      instanceId,
      recent,
    );
    await db.raw().run(
      `INSERT INTO activities (
         id, source_id, instance_id, session_id, timestamp, actor_type, actor_id,
         action_type, description, status
       ) VALUES (
         'a-new', 'claude-code', ?, 's-new', ?, 'user', 'user',
         'message', 'new', 'success'
       )`,
      instanceId,
      recent,
    );

    const result = await runDataClassRetention(db.raw(), {
      activitiesDays: 90,
      sessionsDays: 90,
      inferenceDays: 90,
      runtimeDays: 7,
      generationsDays: 90,
      jobsDays: 90,
    });

    expect(result.activitiesDeleted).toBeGreaterThanOrEqual(1);
    const remaining = await db
      .raw()
      .all<{ id: string }[]>(`SELECT id FROM activities`);
    expect(remaining.map((r) => r.id)).toEqual(["a-new"]);
  });

  test("purgeSensitiveStoredFields nulls details", async () => {
    const instanceId = "claude-code@arch-desktop";
    await db.raw().run(
      `INSERT INTO sessions (id, source_id, instance_id, external_id, started_at)
       VALUES ('s1', 'claude-code', ?, 'e1', datetime('now'))`,
      instanceId,
    );
    await db.raw().run(
      `INSERT INTO activities (
         id, source_id, instance_id, session_id, timestamp, actor_type, actor_id,
         action_type, description, details, status, result
       ) VALUES (
         'a1', 'claude-code', ?, 's1', datetime('now'), 'user', 'user',
         'message', 'hello', '{"x":1}', 'success', '{"y":2}'
       )`,
      instanceId,
    );
    const r = await purgeSensitiveStoredFields(db.raw());
    expect(r.activitiesUpdated).toBe(1);
    const row = await db.raw().get<{
      details: string | null;
      result: string | null;
    }>(`SELECT details, result FROM activities WHERE id = 'a1'`);
    expect(row?.details).toBeNull();
    expect(row?.result).toBeNull();
  });
});

describe("resolveAuthConfig viewer validation", () => {
  test("throws when viewer username set without hash", () => {
    const saved = {
      MC_AUTH_ENABLED: process.env.MC_AUTH_ENABLED,
      MC_PASSWORD_HASH: process.env.MC_PASSWORD_HASH,
      MC_VIEWER_USERNAME: process.env.MC_VIEWER_USERNAME,
      MC_VIEWER_PASSWORD_HASH: process.env.MC_VIEWER_PASSWORD_HASH,
    };
    try {
      process.env.MC_AUTH_ENABLED = "true";
      process.env.MC_PASSWORD_HASH = "hash";
      process.env.MC_VIEWER_USERNAME = "viewer";
      delete process.env.MC_VIEWER_PASSWORD_HASH;
      expect(() => resolveAuthConfig()).toThrow(/MC_VIEWER_PASSWORD_HASH/);
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});

// silence unused import in case tree-shake
void redactText;
void TEST_DB;
