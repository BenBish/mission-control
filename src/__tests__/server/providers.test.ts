/**
 * Provider routes integration tests — status, sync, usage breakdown.
 * Uses mocked connector HTTP via env + inject only through sync path.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import express from "express";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Database } from "../../db/database.js";
import { setupRoutes } from "../../server/routes/index.js";
import { upsertProviderUsage } from "../../db/queries/provider-usage.js";

let fixtureDir: string;
let server: ReturnType<ReturnType<typeof express>["listen"]>;
let baseUrl: string;
let db: Database;

beforeAll(async () => {
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-prov-routes-"));
  db = new Database(path.join(fixtureDir, "test.db"));
  await db.initialize();

  // Seed a known API-sourced row for breakdown reads
  await upsertProviderUsage(db.raw(), {
    provider: "openrouter",
    day: "2026-07-10",
    model: "test/model",
    inputTokens: 42,
    outputTokens: 7,
    costUsd: 0.003,
    requestCount: 1,
  });

  const app = express();
  app.use(express.json());
  setupRoutes(app, db);

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  if (server) server.close();
  await db.close().catch(() => {});
  if (fixtureDir) fs.rmSync(fixtureDir, { recursive: true, force: true });
});

describe("GET /api/providers/status", () => {
  test("returns four providers without secrets", async () => {
    const res = await fetch(`${baseUrl}/api/providers/status`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.providers).toHaveLength(4);
    const ids = body.providers.map((p: { id: string }) => p.id).sort();
    expect(ids).toEqual(["anthropic", "openai", "openrouter", "xai"]);
    for (const p of body.providers) {
      expect(p).not.toHaveProperty("apiKey");
      // No live secret material in the payload (notes may mention key prefixes)
      expect(JSON.stringify(p)).not.toMatch(/sk-[a-zA-Z0-9]{10,}/);
      expect(Array.isArray(p.envVars)).toBe(true);
      expect(typeof p.status).toBe("string");
    }
  });
});

describe("GET /api/providers/usage", () => {
  test("returns API-sourced usage with source marker", async () => {
    const res = await fetch(`${baseUrl}/api/providers/usage`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.source).toBe("provider-api");
    expect(
      body.usage.some((u: { model: string }) => u.model === "test/model"),
    ).toBe(true);
  });
});

describe("GET /api/providers/usage/breakdown", () => {
  test("aggregates by provider and model", async () => {
    const res = await fetch(
      `${baseUrl}/api/providers/usage/breakdown?since=2026-07-01`,
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.source).toBe("provider-api");
    const row = body.breakdown.find(
      (r: { model: string }) => r.model === "test/model",
    );
    expect(row).toBeTruthy();
    expect(row.input_tokens).toBe(42);
    expect(row.cost_usd).toBeCloseTo(0.003);
  });
});

describe("POST /api/providers/sync", () => {
  test("without keys marks not_configured and does not crash", async () => {
    const prev = {
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
      ANTHROPIC_ADMIN_KEY: process.env.ANTHROPIC_ADMIN_KEY,
      OPENAI_ADMIN_KEY: process.env.OPENAI_ADMIN_KEY,
      XAI_API_KEY: process.env.XAI_API_KEY,
    };
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.ANTHROPIC_ADMIN_KEY;
    delete process.env.OPENAI_ADMIN_KEY;
    delete process.env.XAI_API_KEY;

    try {
      const res = await fetch(`${baseUrl}/api/providers/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.results).toHaveLength(4);
      for (const r of body.results) {
        expect(r.status).toBe("not_configured");
      }

      const statusRes = await fetch(`${baseUrl}/api/providers/status`);
      const statusBody = await statusRes.json();
      for (const p of statusBody.providers) {
        expect(p.status).toBe("not_configured");
      }
    } finally {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});
