/**
 * Lemonade poller tests — against a local mock HTTP server, NOT a live
 * Lemonade instance. No live instance was reachable (see
 * src/collectors/lemonade/config.ts's doc comment: it requires a
 * root-managed systemd service that was never set up, no sudo access to
 * start it). These tests only prove the poller correctly parses the
 * *assumed* shapes and degrades gracefully when they're wrong — they do
 * not prove the assumed shapes are correct. Re-verify against a real
 * instance before trusting this poller's output in production.
 */

import { describe, test, expect, afterAll } from "bun:test";

let responses: Record<string, { status: number; body: unknown } | null> = {};

// Bun.serve() starts listening synchronously — set up the mock server and
// point config.ts's env var at it *before* dynamically importing the
// poller module below, since LEMONADE_BASE_URL is read once at that
// module's top-level eval time. A beforeAll() hook would run too late —
// bun:test registers it but doesn't execute it until after this file's
// top-level code (including a top-level `await import`) has already run.
const server = Bun.serve({
  port: 0,
  fetch(req) {
    const url = new URL(req.url);
    const configured = responses[url.pathname];
    if (configured === null || configured === undefined) {
      return new Response("not found", { status: 404 });
    }
    return Response.json(configured.body, { status: configured.status });
  },
});
process.env.MC_LEMONADE_URL = `http://localhost:${server.port}`;

afterAll(() => {
  server.stop();
  delete process.env.MC_LEMONADE_URL;
});

const { pollHealth, pollSystemStats, pollStats } =
  await import("../../../collectors/lemonade/poller.js");

describe("pollHealth", () => {
  test("returns true when the endpoint responds 200", async () => {
    responses = { "/api/v1/health": { status: 200, body: { status: "ok" } } };
    expect(await pollHealth()).toBe(true);
  });

  test("returns false when unreachable (server not running)", async () => {
    responses = {};
    expect(await pollHealth()).toBe(false);
  });

  test("returns false on a non-2xx response", async () => {
    responses = { "/api/v1/health": { status: 500, body: {} } };
    expect(await pollHealth()).toBe(false);
  });
});

describe("pollSystemStats", () => {
  test("wraps a successful response into a runtime_snapshot payload", async () => {
    responses = {
      "/api/v1/system-stats": {
        status: 200,
        body: { cpu_percent: 12.5, vram_used_mb: 4096 },
      },
    };
    const snapshot = await pollSystemStats();
    expect(snapshot).not.toBeNull();
    expect(snapshot?.kind).toBe("system");
    expect(snapshot?.healthy).toBe(true);
    expect((snapshot?.payload as Record<string, unknown>).cpu_percent).toBe(
      12.5,
    );
  });

  test("returns null when unreachable, doesn't throw", async () => {
    responses = {};
    expect(await pollSystemStats()).toBeNull();
  });
});

describe("pollStats", () => {
  test("array response maps each entry to an inference_request", async () => {
    responses = {
      "/api/v1/stats": {
        status: 200,
        body: [
          {
            id: "req-1",
            model: "some-model",
            prompt_tokens: 10,
            completion_tokens: 5,
            ttft_ms: 50,
          },
          {
            id: "req-2",
            model: "some-model",
            prompt_tokens: 20,
            completion_tokens: 8,
          },
        ],
      },
    };
    const result = await pollStats();
    expect(result.requests).toHaveLength(2);
    expect(result.requests[0].externalId).toBe("req-1");
    expect(result.requests[0].promptTokens).toBe(10);
    expect(result.aggregateSnapshot).toBeNull();
  });

  test("single-object response falls back to an aggregate snapshot, not a crash", async () => {
    responses = {
      "/api/v1/stats": {
        status: 200,
        body: { total_requests: 100, avg_ttft_ms: 42 },
      },
    };
    const result = await pollStats();
    expect(result.requests).toHaveLength(0);
    expect(result.aggregateSnapshot).not.toBeNull();
    expect(result.aggregateSnapshot?.kind).toBe("system");
  });

  test("unreachable server returns empty, doesn't throw", async () => {
    responses = {};
    const result = await pollStats();
    expect(result.requests).toHaveLength(0);
    expect(result.aggregateSnapshot).toBeNull();
  });

  test("missing fields on array entries don't crash — fields just come through undefined", async () => {
    responses = {
      "/api/v1/stats": { status: 200, body: [{}] },
    };
    const result = await pollStats();
    expect(result.requests).toHaveLength(1);
    expect(result.requests[0].externalId).toBeUndefined();
    expect(result.requests[0].status).toBe("success"); // defaults to success, not "error", when status field is absent
  });
});
