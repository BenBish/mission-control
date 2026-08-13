/**
 * Provider connector unit tests — normalize + mocked HTTP sync/idempotency.
 * No live billing API calls; secrets never required.
 */

import {
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Database } from "../../db/database.js";
import { latestProviderCreditSnapshots } from "../../db/queries/provider-credits.js";
import {
  getProviderUsage,
  getProviderUsageBreakdown,
  listProviderSyncStatus,
} from "../../db/queries/provider-usage.js";
import { insertQuotaSnapshot } from "../../db/queries/telemetry.js";
import {
  mergeAnthropicRows,
  normalizeAnthropicCost,
  normalizeAnthropicUsage,
  normalizeOpenAICompletionsUsage,
  normalizeOpenAICosts,
  mergeOpenAIRows,
  normalizeOpenAILineItem,
  normalizeOpenRouterActivity,
  normalizeXaiUsage,
  normalizeOpenRouterCredits,
  capacitySurfaceOf,
  anthropicCreditsUnavailable,
  openaiWalletUnavailable,
  xaiCreditsLimited,
  normalizeSessionQuotaToCredits,
  SESSION_QUOTA_SOURCE_BY_PROVIDER,
  syncAllProviders,
  syncProvider,
  openrouterConnector,
  anthropicConnector,
  openaiConnector,
  xaiConnector,
  getConnectors,
  resetSyncInFlightForTests,
  ProviderHttpError,
  type FetchImpl,
} from "../../services/provider-connectors/index.js";
import {
  providerFetchJson,
  sanitizeMessage,
} from "../../services/provider-connectors/http.js";

let fixtureDir: string;
let db: Database;

const savedEnv: Record<string, string | undefined> = {};

function setEnv(key: string, value: string | undefined) {
  if (!(key in savedEnv)) savedEnv[key] = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function restoreEnv() {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  for (const k of Object.keys(savedEnv)) delete savedEnv[k];
}

beforeAll(async () => {
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-providers-"));
  db = new Database(path.join(fixtureDir, "test.db"));
  await db.initialize();
});

afterAll(async () => {
  restoreEnv();
  await db.close().catch(() => {});
  if (fixtureDir) fs.rmSync(fixtureDir, { recursive: true, force: true });
});

beforeEach(async () => {
  restoreEnv();
  resetSyncInFlightForTests();
  await db.raw().run(`DELETE FROM provider_usage_daily`);
  await db.raw().run(`DELETE FROM provider_sync_status`);
  await db.raw().run(`DELETE FROM provider_credit_snapshots`);
  await db.raw().run(`DELETE FROM quota_snapshots`);
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Seed registry rows so quota_snapshots FK constraints succeed. */
async function seedSourceAndInstance(
  raw: ReturnType<Database["raw"]>,
  sourceId: string,
  instanceId: string,
) {
  await raw.run(
    `INSERT OR IGNORE INTO sources (id, name, kind, default_unit) VALUES (?, ?, 'agentic', 'quota')`,
    sourceId,
    sourceId,
  );
  await raw.run(
    `INSERT OR IGNORE INTO source_instances (id, source_id, machine, collector_kind, status)
     VALUES (?, ?, 'test', 'jsonl-push', 'ok')`,
    instanceId,
    sourceId,
  );
}

// ─── Normalize (pure) ───────────────────────────────────────────────────────

describe("normalizeOpenRouterActivity", () => {
  test("aggregates by day+model and sums cost including BYOK", () => {
    const rows = normalizeOpenRouterActivity({
      data: [
        {
          date: "2026-07-01",
          model: "anthropic/claude-sonnet-4",
          prompt_tokens: 100,
          completion_tokens: 50,
          usage: 0.01,
          byok_usage_inference: 0.002,
          requests: 2,
        },
        {
          date: "2026-07-01",
          model: "anthropic/claude-sonnet-4",
          prompt_tokens: 40,
          completion_tokens: 10,
          usage: 0.005,
          byok_usage_inference: 0,
          requests: 1,
        },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].provider).toBe("openrouter");
    expect(rows[0].day).toBe("2026-07-01");
    expect(rows[0].inputTokens).toBe(140);
    expect(rows[0].outputTokens).toBe(60);
    expect(rows[0].costUsd).toBeCloseTo(0.017);
    expect(rows[0].requestCount).toBe(3);
  });
});

describe("normalizeAnthropicUsage + cost merge", () => {
  test("maps usage buckets and merges cost by day+model", () => {
    const usage = normalizeAnthropicUsage({
      data: [
        {
          starting_at: "2026-07-02T00:00:00Z",
          results: [
            {
              model: "claude-sonnet-4-20250514",
              uncached_input_tokens: 1000,
              cache_read_input_tokens: 200,
              output_tokens: 300,
            },
          ],
        },
      ],
    });
    expect(usage[0].inputTokens).toBe(1200);
    expect(usage[0].outputTokens).toBe(300);
    expect(usage[0].costUsd).toBeNull();

    const cost = normalizeAnthropicCost({
      data: [
        {
          starting_at: "2026-07-02T00:00:00Z",
          results: [
            {
              model: "claude-sonnet-4-20250514",
              amount: "250",
            },
          ],
        },
      ],
    });
    expect(cost[0].costUsd).toBeCloseTo(2.5);

    // Fractional-cent string is still cents (docs: lowest units), not dollars.
    const fractional = normalizeAnthropicCost({
      data: [
        {
          starting_at: "2026-07-02T00:00:00Z",
          results: [{ model: "claude-sonnet-4-20250514", amount: "123.45" }],
        },
      ],
    });
    expect(fractional[0].costUsd).toBeCloseTo(1.2345);

    const merged = mergeAnthropicRows(usage, cost);
    expect(merged).toHaveLength(1);
    expect(merged[0].inputTokens).toBe(1200);
    expect(merged[0].costUsd).toBeCloseTo(2.5);
  });
});

describe("normalizeOpenAICompletionsUsage + costs", () => {
  test("maps unix buckets and merges line_item costs", () => {
    const start = Math.floor(Date.parse("2026-07-03T00:00:00Z") / 1000);
    const usage = normalizeOpenAICompletionsUsage({
      data: [
        {
          start_time: start,
          results: [
            {
              object: "organization.usage.completions.result",
              model: "gpt-4o",
              input_tokens: 500,
              output_tokens: 100,
              num_model_requests: 4,
            },
          ],
        },
      ],
    });
    expect(usage[0].day).toBe("2026-07-03");
    expect(usage[0].inputTokens).toBe(500);
    expect(usage[0].requestCount).toBe(4);

    const cost = normalizeOpenAICosts({
      data: [
        {
          start_time: start,
          results: [
            {
              object: "organization.costs.result",
              amount: { value: 0.12, currency: "usd" },
              line_item: "gpt-4o",
            },
          ],
        },
      ],
    });
    const merged = mergeOpenAIRows(usage, cost);
    expect(merged[0].costUsd).toBeCloseTo(0.12);
  });

  test("merges cost line_item with trailing , input into usage model", () => {
    expect(normalizeOpenAILineItem("gpt-4o, input")).toBe("gpt-4o");
    const start = Math.floor(Date.parse("2026-07-03T00:00:00Z") / 1000);
    const usage = normalizeOpenAICompletionsUsage({
      data: [
        {
          start_time: start,
          results: [
            {
              object: "organization.usage.completions.result",
              model: "gpt-4o",
              input_tokens: 10,
              output_tokens: 2,
              num_model_requests: 1,
            },
          ],
        },
      ],
    });
    const cost = normalizeOpenAICosts({
      data: [
        {
          start_time: start,
          results: [
            {
              object: "organization.costs.result",
              amount: { value: 0.05, currency: "usd" },
              line_item: "gpt-4o, input",
            },
          ],
        },
      ],
    });
    const merged = mergeOpenAIRows(usage, cost);
    expect(merged).toHaveLength(1);
    expect(merged[0].model).toBe("gpt-4o");
    expect(merged[0].costUsd).toBeCloseTo(0.05);
  });

  test("does not attach gpt-4 cost to gpt-4o via substring match", () => {
    const start = Math.floor(Date.parse("2026-07-03T00:00:00Z") / 1000);
    const usage = normalizeOpenAICompletionsUsage({
      data: [
        {
          start_time: start,
          results: [
            {
              object: "organization.usage.completions.result",
              model: "gpt-4",
              input_tokens: 10,
              output_tokens: 1,
              num_model_requests: 1,
            },
            {
              object: "organization.usage.completions.result",
              model: "gpt-4o",
              input_tokens: 20,
              output_tokens: 2,
              num_model_requests: 1,
            },
          ],
        },
      ],
    });
    const cost = normalizeOpenAICosts({
      data: [
        {
          start_time: start,
          results: [
            {
              object: "organization.costs.result",
              amount: { value: 0.09, currency: "usd" },
              line_item: "gpt-4, input",
            },
          ],
        },
      ],
    });
    const merged = mergeOpenAIRows(usage, cost);
    const gpt4 = merged.find((r) => r.model === "gpt-4");
    const gpt4o = merged.find((r) => r.model === "gpt-4o");
    expect(gpt4?.costUsd).toBeCloseTo(0.09);
    expect(gpt4o?.costUsd).toBeNull();
    expect(gpt4o?.inputTokens).toBe(20);
  });
});

describe("normalizeXaiUsage", () => {
  test("accepts data[] export shape", () => {
    const rows = normalizeXaiUsage({
      data: [
        {
          date: "2026-07-04",
          model: "grok-3",
          input_tokens: 10,
          output_tokens: 5,
          cost_usd: 0.001,
          requests: 1,
        },
      ],
    });
    expect(rows[0].provider).toBe("xai");
    expect(rows[0].model).toBe("grok-3");
    expect(rows[0].costUsd).toBeCloseTo(0.001);
  });
});

describe("sanitizeMessage", () => {
  test("redacts sk- and Bearer tokens", () => {
    const s = sanitizeMessage(
      "auth failed: Bearer sk-ant-admin01-ABCDEFG123456789 and key",
    );
    expect(s).not.toContain("ABCDEFG");
    expect(s).toContain("Bearer ***");
  });
});

describe("providerFetchJson timeout", () => {
  test("hung fetch rejects with timeout without hanging the suite", async () => {
    const hung: FetchImpl = (_url, init) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return;
        if (signal.aborted) {
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        signal.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      });

    await expect(
      providerFetchJson(
        "openrouter",
        "https://example.test/hang",
        {},
        hung,
        20,
      ),
    ).rejects.toMatchObject({
      name: "ProviderHttpError",
      message: expect.stringMatching(/timed out after 20ms/i),
    });
  });
});

// ─── Connector fetch (mocked HTTP) ──────────────────────────────────────────

describe("openrouter connector fetchUsage", () => {
  test("success path yields normalized rows", async () => {
    setEnv("OPENROUTER_API_KEY", "test-or-key");
    const fetchImpl: FetchImpl = async () =>
      jsonResponse({
        data: [
          {
            date: "2026-07-05",
            model: "openai/gpt-4.1",
            prompt_tokens: 50,
            completion_tokens: 25,
            usage: 0.015,
            byok_usage_inference: 0,
            requests: 5,
          },
        ],
      });
    const result = await openrouterConnector.fetchUsage(
      { start: new Date("2026-07-01"), end: new Date("2026-07-10") },
      fetchImpl,
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].model).toBe("openai/gpt-4.1");
    expect(result.rows[0].costUsd).toBeCloseTo(0.015);
  });

  test("401 yields ProviderHttpError", async () => {
    setEnv("OPENROUTER_API_KEY", "bad-key");
    const fetchImpl: FetchImpl = async () =>
      new Response(JSON.stringify({ error: { message: "Unauthorized" } }), {
        status: 401,
      });
    await expect(
      openrouterConnector.fetchUsage(
        { start: new Date(), end: new Date() },
        fetchImpl,
      ),
    ).rejects.toBeInstanceOf(ProviderHttpError);
  });

  test("filters activity rows to the requested FetchWindow", async () => {
    setEnv("OPENROUTER_API_KEY", "test-or-key");
    const fetchImpl: FetchImpl = async () =>
      jsonResponse({
        data: [
          {
            date: "2026-06-01",
            model: "old/model",
            prompt_tokens: 1,
            completion_tokens: 1,
            usage: 0.001,
            byok_usage_inference: 0,
            requests: 1,
          },
          {
            date: "2026-07-05",
            model: "openai/gpt-4.1",
            prompt_tokens: 50,
            completion_tokens: 25,
            usage: 0.015,
            byok_usage_inference: 0,
            requests: 5,
          },
        ],
      });
    const result = await openrouterConnector.fetchUsage(
      {
        start: new Date("2026-07-01T00:00:00Z"),
        end: new Date("2026-07-10T00:00:00Z"),
      },
      fetchImpl,
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].day).toBe("2026-07-05");
  });
});

describe("anthropic connector fetchUsage", () => {
  test("success path merges usage", async () => {
    setEnv("ANTHROPIC_ADMIN_KEY", "sk-ant-admin01-test");
    let calls = 0;
    const fetchImpl: FetchImpl = async (url) => {
      calls++;
      const u = String(url);
      if (u.includes("usage_report")) {
        return jsonResponse({
          data: [
            {
              starting_at: "2026-07-06T00:00:00Z",
              results: [
                {
                  model: "claude-opus-4",
                  uncached_input_tokens: 100,
                  output_tokens: 20,
                },
              ],
            },
          ],
        });
      }
      return jsonResponse({
        data: [
          {
            starting_at: "2026-07-06T00:00:00Z",
            results: [{ model: "claude-opus-4", amount: "100" }],
          },
        ],
      });
    };
    const requestedUrls: string[] = [];
    const fetchImplWithCapture: FetchImpl = async (url, init) => {
      requestedUrls.push(String(url));
      return fetchImpl(url, init);
    };
    const result = await anthropicConnector.fetchUsage(
      {
        start: new Date("2026-07-01T12:00:00Z"),
        end: new Date("2026-07-10T15:00:00Z"),
      },
      fetchImplWithCapture,
    );
    expect(calls).toBeGreaterThanOrEqual(1);
    expect(result.rows[0].inputTokens).toBe(100);
    expect(result.rows[0].costUsd).toBeCloseTo(1);
    // limit=31 so 30-day windows are not truncated to the API default of 7.
    expect(requestedUrls[0]).toContain("limit=31");
    // ending_at exclusive → day after window.end so "today" is included.
    expect(requestedUrls[0]).toContain("ending_at=2026-07-11T00%3A00%3A00Z");
  });

  test("429 yields ProviderHttpError", async () => {
    setEnv("ANTHROPIC_ADMIN_KEY", "sk-ant-admin01-test");
    const fetchImpl: FetchImpl = async () =>
      new Response("rate limited", { status: 429 });
    await expect(
      anthropicConnector.fetchUsage(
        { start: new Date(), end: new Date() },
        fetchImpl,
      ),
    ).rejects.toMatchObject({ status: 429 });
  });
});

describe("openai connector fetchUsage", () => {
  test("success path yields model usage", async () => {
    setEnv("OPENAI_ADMIN_KEY", "sk-admin-test");
    const start = Math.floor(Date.parse("2026-07-07T00:00:00Z") / 1000);
    const fetchImpl: FetchImpl = async (url) => {
      const u = String(url);
      if (u.includes("/costs")) {
        return jsonResponse({
          data: [
            {
              start_time: start,
              results: [
                {
                  object: "organization.costs.result",
                  amount: { value: 0.06, currency: "usd" },
                  line_item: "gpt-4o-mini",
                },
              ],
            },
          ],
        });
      }
      return jsonResponse({
        data: [
          {
            start_time: start,
            results: [
              {
                object: "organization.usage.completions.result",
                model: "gpt-4o-mini",
                input_tokens: 80,
                output_tokens: 20,
                num_model_requests: 2,
              },
            ],
          },
        ],
      });
    };
    const result = await openaiConnector.fetchUsage(
      { start: new Date("2026-07-01"), end: new Date("2026-07-10") },
      fetchImpl,
    );
    expect(result.rows.some((r) => r.model.includes("gpt-4o-mini"))).toBe(true);
  });
});

describe("xai connector fetchUsage", () => {
  test("without usage endpoint returns limited empty rows after models check", async () => {
    setEnv("XAI_API_KEY", "xai-test-key");
    setEnv("MC_XAI_USAGE_ENDPOINT", undefined);
    const fetchImpl: FetchImpl = async () =>
      jsonResponse({ data: [{ id: "grok-3" }] });
    const result = await xaiConnector.fetchUsage(
      { start: new Date(), end: new Date() },
      fetchImpl,
    );
    expect(result.rows).toHaveLength(0);
    expect(result.limitation).toMatch(/no public historical usage/i);
  });

  test("MC_XAI_USAGE_ENDPOINT normalizes export JSON", async () => {
    setEnv("XAI_API_KEY", "xai-test-key");
    setEnv("MC_XAI_USAGE_ENDPOINT", "https://example.test/xai-usage");
    const fetchImpl: FetchImpl = async () =>
      jsonResponse({
        data: [
          {
            date: "2026-07-08",
            model: "grok-3",
            input_tokens: 9,
            output_tokens: 3,
            cost_usd: 0.002,
          },
        ],
      });
    const result = await xaiConnector.fetchUsage(
      { start: new Date(), end: new Date() },
      fetchImpl,
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].inputTokens).toBe(9);
  });
});

// ─── Sync orchestration + idempotency ───────────────────────────────────────

describe("syncProvider idempotency", () => {
  /** Day inside defaultFetchWindow(30) so activity rows are not filtered out. */
  const recentDay = () => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 2);
    return d.toISOString().slice(0, 10);
  };

  test("second identical sync does not double-count", async () => {
    setEnv("OPENROUTER_API_KEY", "test-or-key");
    const day = recentDay();
    const fetchImpl: FetchImpl = async () =>
      jsonResponse({
        data: [
          {
            date: day,
            model: "meta/llama",
            prompt_tokens: 1000,
            completion_tokens: 100,
            usage: 0.5,
            byok_usage_inference: 0,
            requests: 10,
          },
        ],
      });

    const r1 = await syncProvider(db.raw(), openrouterConnector, { fetchImpl });
    expect(r1.status).toBe("ok");
    expect(r1.rowsUpserted).toBe(1);

    const r2 = await syncProvider(db.raw(), openrouterConnector, { fetchImpl });
    expect(r2.status).toBe("ok");

    const usage = await getProviderUsage(db.raw(), { provider: "openrouter" });
    expect(usage).toHaveLength(1);
    expect(usage[0].input_tokens).toBe(1000);
    expect(usage[0].cost_usd).toBeCloseTo(0.5);

    const breakdown = await getProviderUsageBreakdown(db.raw(), {
      provider: "openrouter",
    });
    expect(breakdown[0].input_tokens).toBe(1000);
  });

  test("auth failure records error status without throwing from syncAll", async () => {
    setEnv("OPENROUTER_API_KEY", "secret-or-key-value");
    setEnv("ANTHROPIC_ADMIN_KEY", undefined);
    setEnv("OPENAI_ADMIN_KEY", undefined);
    setEnv("XAI_API_KEY", undefined);

    const fetchImpl: FetchImpl = async () =>
      new Response("nope", { status: 401 });

    const results = await syncAllProviders(db.raw(), {
      providers: ["openrouter"],
      fetchImpl,
    });
    expect(results[0].status).toBe("error");
    expect(results[0].error).toMatch(/auth/i);

    const statuses = await listProviderSyncStatus(db.raw());
    const or = statuses.find((s) => s.provider === "openrouter");
    expect(or?.status).toBe("error");
    expect(or?.last_error).toBeTruthy();
    expect(or?.last_error).not.toContain("secret-or-key-value");
  });

  test("missing credentials → not_configured", async () => {
    setEnv("OPENROUTER_API_KEY", undefined);
    const r = await syncProvider(db.raw(), openrouterConnector);
    expect(r.status).toBe("not_configured");
    const statuses = await listProviderSyncStatus(db.raw());
    expect(statuses.find((s) => s.provider === "openrouter")?.status).toBe(
      "not_configured",
    );
  });

  test("all four connectors registered", () => {
    const ids = getConnectors()
      .map((c) => c.id)
      .sort();
    expect(ids).toEqual(["anthropic", "openai", "openrouter", "xai"]);
  });

  test("re-sync prunes models removed from a day", async () => {
    setEnv("OPENROUTER_API_KEY", "test-or-key");
    const day = recentDay();
    const first: FetchImpl = async () =>
      jsonResponse({
        data: [
          {
            date: day,
            model: "meta/llama",
            prompt_tokens: 100,
            completion_tokens: 10,
            usage: 0.1,
            byok_usage_inference: 0,
            requests: 1,
          },
          {
            date: day,
            model: "gone/model",
            prompt_tokens: 50,
            completion_tokens: 5,
            usage: 0.05,
            byok_usage_inference: 0,
            requests: 1,
          },
        ],
      });
    await syncProvider(db.raw(), openrouterConnector, { fetchImpl: first });
    expect(
      (await getProviderUsage(db.raw(), { provider: "openrouter" })).length,
    ).toBe(2);

    const second: FetchImpl = async () =>
      jsonResponse({
        data: [
          {
            date: day,
            model: "meta/llama",
            prompt_tokens: 100,
            completion_tokens: 10,
            usage: 0.1,
            byok_usage_inference: 0,
            requests: 1,
          },
        ],
      });
    const r2 = await syncProvider(db.raw(), openrouterConnector, {
      fetchImpl: second,
    });
    expect(r2.rowsPruned).toBe(1);
    const usage = await getProviderUsage(db.raw(), { provider: "openrouter" });
    expect(usage).toHaveLength(1);
    expect(usage[0].model).toBe("meta/llama");
  });

  test("xai limited status keeps lastError null and stores limitation in meta", async () => {
    setEnv("XAI_API_KEY", "xai-test-key");
    setEnv("MC_XAI_USAGE_ENDPOINT", undefined);
    const fetchImpl: FetchImpl = async () =>
      jsonResponse({ data: [{ id: "grok-3" }] });
    const r = await syncProvider(db.raw(), xaiConnector, { fetchImpl });
    expect(r.status).toBe("limited");
    expect(r.limitation).toBeTruthy();
    const statuses = await listProviderSyncStatus(db.raw());
    const row = statuses.find((s) => s.provider === "xai");
    expect(row?.status).toBe("limited");
    expect(row?.last_error).toBeNull();
    const meta = row?.meta_json ? JSON.parse(row.meta_json) : {};
    expect(meta.limitation).toMatch(/no public historical usage/i);
  });

  test("concurrent syncAllProviders skips when one is in flight", async () => {
    setEnv("OPENROUTER_API_KEY", "test-or-key");
    setEnv("ANTHROPIC_ADMIN_KEY", undefined);
    setEnv("OPENAI_ADMIN_KEY", undefined);
    setEnv("XAI_API_KEY", undefined);

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchImpl: FetchImpl = async (url) => {
      await gate;
      const u = String(url);
      // Wallet path after activity — return a valid credits payload.
      if (u.includes("/credits")) {
        return jsonResponse({
          data: { total_credits: 10, total_usage: 1 },
        });
      }
      return jsonResponse({ data: [] });
    };

    const first = syncAllProviders(db.raw(), {
      providers: ["openrouter"],
      fetchImpl,
    });
    // Let the first call mark itself in-flight
    await Promise.resolve();
    const second = await syncAllProviders(db.raw(), {
      providers: ["openrouter"],
      fetchImpl,
    });
    expect(second).toHaveLength(1);
    expect(second[0].provider).toBe("openrouter");
    expect(second[0].status).toBe("skipped");
    release();
    const firstResults = await first;
    expect(firstResults[0].status).toBe("ok");
  });

  test("anthropic sync stores unavailable prepaid_balance credit snapshot", async () => {
    setEnv("ANTHROPIC_ADMIN_KEY", "sk-ant-admin01-test");
    const fetchImpl: FetchImpl = async (url) => {
      const u = String(url);
      if (u.includes("usage_report")) {
        return jsonResponse({
          data: [
            {
              starting_at: "2026-07-06T00:00:00Z",
              results: [
                {
                  model: "claude-sonnet-4",
                  uncached_input_tokens: 10,
                  output_tokens: 2,
                },
              ],
            },
          ],
        });
      }
      return jsonResponse({ data: [] });
    };
    const r = await syncProvider(db.raw(), anthropicConnector, { fetchImpl });
    expect(r.status).toBe("ok");
    expect((r.creditSnapshots ?? 0) >= 1).toBe(true);
    const credits = await latestProviderCreditSnapshots(db.raw(), {
      provider: "anthropic",
    });
    expect(credits.some((c) => c.label === "prepaid_balance")).toBe(true);
    const bal = credits.find((c) => c.label === "prepaid_balance");
    expect(bal?.status).toBe("unavailable");
    expect(bal?.remaining).toBeNull();
    // Must not invent spend in usage from credits
    const usage = await getProviderUsage(db.raw(), { provider: "anthropic" });
    expect(usage[0].cost_usd == null || usage[0].cost_usd === 0).toBe(true);
  });

  test("openai sync stores unavailable wallet without calling credit_grants", async () => {
    setEnv("OPENAI_ADMIN_KEY", "sk-admin-test");
    const requested: string[] = [];
    const fetchImpl: FetchImpl = async (url) => {
      const u = String(url);
      requested.push(u);
      if (u.includes("usage/completions")) {
        return jsonResponse({
          data: [
            {
              start_time: Math.floor(
                new Date("2026-07-06T00:00:00Z").getTime() / 1000,
              ),
              results: [
                {
                  model: "gpt-4.1",
                  input_tokens: 100,
                  output_tokens: 50,
                  num_model_requests: 1,
                },
              ],
            },
          ],
        });
      }
      if (u.includes("organization/costs")) {
        return jsonResponse({ data: [] });
      }
      return jsonResponse({});
    };
    const r = await syncProvider(db.raw(), openaiConnector, { fetchImpl });
    expect(r.status).toBe("ok");
    expect(requested.some((u) => u.includes("credit_grants"))).toBe(false);
    const credits = await latestProviderCreditSnapshots(db.raw(), {
      provider: "openai",
    });
    const bal = credits.find((c) => c.label === "prepaid_balance");
    expect(bal?.status).toBe("unavailable");
    expect(bal?.remaining).toBeNull();
    const meta = bal?.details_json ? JSON.parse(bal.details_json) : {};
    expect(meta.surface).toBe("wallet");
  });

  test("SESSION_QUOTA_SOURCE_BY_PROVIDER maps openai→codex, anthropic→claude-code, xai→grok", () => {
    expect(SESSION_QUOTA_SOURCE_BY_PROVIDER.openai).toBe("codex");
    expect(SESSION_QUOTA_SOURCE_BY_PROVIDER.anthropic).toBe("claude-code");
    expect(SESSION_QUOTA_SOURCE_BY_PROVIDER.xai).toBe("grok");
  });

  test("unconfigured anthropic bridges claude-code quota snapshots and drops plan_usage_unavailable", async () => {
    // No ANTHROPIC_ADMIN_KEY — still bridges session quotas (BSH-147).
    setEnv("ANTHROPIC_ADMIN_KEY", undefined);
    await seedSourceAndInstance(db.raw(), "claude-code", "claude-code@test");
    await insertQuotaSnapshot(db.raw(), "claude-code", "claude-code@test", {
      timestamp: "2026-08-10T12:00:00.000Z",
      limitId: "claude:5h",
      usedPercent: 38,
      windowMinutes: 300,
      resetsAt: "2026-08-10T17:00:00.000Z",
    });
    await insertQuotaSnapshot(db.raw(), "claude-code", "claude-code@test", {
      timestamp: "2026-08-10T12:00:00.000Z",
      limitId: "claude:7d",
      usedPercent: 12,
      windowMinutes: 10080,
      resetsAt: "2026-08-12T00:00:00.000Z",
    });

    const r = await syncProvider(db.raw(), anthropicConnector, {
      fetchImpl: async () => jsonResponse({}),
    });
    expect(r.status).toBe("not_configured");
    expect((r.creditSnapshots ?? 0) >= 2).toBe(true);

    const credits = await latestProviderCreditSnapshots(db.raw(), {
      provider: "anthropic",
    });
    const planRows = credits.filter((c) => {
      const d = c.details_json ? JSON.parse(c.details_json) : {};
      return d.surface === "plan_usage" || c.unit === "percent";
    });
    expect(planRows.some((c) => c.source === "session_quota")).toBe(true);
    expect(planRows.every((c) => c.label !== "plan_usage_unavailable")).toBe(
      true,
    );
    expect(credits.some((c) => c.label === "plan_usage_unavailable")).toBe(
      false,
    );
    const fiveH = credits.find((c) => c.label.includes("claude:5h"));
    expect(fiveH?.source).toBe("session_quota");
    expect(fiveH?.remaining).toBe(62); // 100 - 38
    expect(fiveH?.unit).toBe("percent");
  });

  test("openai sync still bridges codex quota snapshots", async () => {
    setEnv("OPENAI_ADMIN_KEY", undefined);
    await seedSourceAndInstance(db.raw(), "codex", "codex@test");
    await insertQuotaSnapshot(db.raw(), "codex", "codex@test", {
      timestamp: "2026-08-10T12:00:00.000Z",
      limitId: "codex:primary",
      usedPercent: 25,
      windowMinutes: 300,
      resetsAt: "2026-08-10T17:00:00.000Z",
    });
    const r = await syncProvider(db.raw(), openaiConnector, {
      fetchImpl: async () => jsonResponse({}),
    });
    expect(r.status).toBe("not_configured");
    const credits = await latestProviderCreditSnapshots(db.raw(), {
      provider: "openai",
    });
    const plan = credits.find((c) => c.source === "session_quota");
    expect(plan).toBeTruthy();
    expect(plan?.remaining).toBe(75);
  });

  test("openrouter sync stores wallet balance from /credits", async () => {
    setEnv("OPENROUTER_API_KEY", "test-or-key");
    const fetchImpl: FetchImpl = async (url) => {
      const u = String(url);
      if (u.includes("/credits")) {
        return jsonResponse({
          data: { total_credits: 100.5, total_usage: 25.75 },
        });
      }
      // activity
      return jsonResponse({
        data: [
          {
            date: "2026-07-09",
            model: "openai/gpt-4.1",
            prompt_tokens: 10,
            completion_tokens: 5,
            usage: 0.01,
            byok_usage_inference: 0,
            requests: 1,
          },
        ],
      });
    };
    const r = await syncProvider(db.raw(), openrouterConnector, { fetchImpl });
    expect(r.status).toBe("ok");
    expect((r.creditSnapshots ?? 0) >= 1).toBe(true);
    const credits = await latestProviderCreditSnapshots(db.raw(), {
      provider: "openrouter",
    });
    const bal = credits.find((c) => c.label === "prepaid_balance");
    expect(bal?.status).toBe("ok");
    expect(bal?.remaining).toBeCloseTo(74.75);
    expect(bal?.unit).toBe("usd");
    const usage = await getProviderUsage(db.raw(), { provider: "openrouter" });
    for (const row of usage) {
      expect(row.cost_usd).not.toBe(74.75);
    }
  });

  test("xai sync stores limited credit snapshot", async () => {
    setEnv("XAI_API_KEY", "xai-test-key");
    setEnv("MC_XAI_USAGE_ENDPOINT", undefined);
    const fetchImpl: FetchImpl = async () =>
      jsonResponse({ data: [{ id: "grok-3" }] });
    await syncProvider(db.raw(), xaiConnector, { fetchImpl });
    const credits = await latestProviderCreditSnapshots(db.raw(), {
      provider: "xai",
    });
    const wallet = credits.find((c) => c.label === "prepaid_balance");
    expect(wallet?.status).toBe("limited");
    expect(wallet?.remaining).toBeNull();
    expect(credits.some((c) => c.label === "plan_usage_unavailable")).toBe(
      true,
    );
  });

  test("unconfigured xai bridges grok quota snapshots and drops plan_usage_unavailable", async () => {
    setEnv("XAI_API_KEY", undefined);
    await seedSourceAndInstance(db.raw(), "grok", "grok@test");
    await insertQuotaSnapshot(db.raw(), "grok", "grok@test", {
      timestamp: "2026-08-13T12:00:00.000Z",
      limitId: "grok:week",
      usedPercent: 53,
      windowMinutes: 10080,
      resetsAt: "2026-08-17T02:53:15.569Z",
    });

    const r = await syncProvider(db.raw(), xaiConnector, {
      fetchImpl: async () => jsonResponse({}),
    });
    expect(r.status).toBe("not_configured");
    expect((r.creditSnapshots ?? 0) >= 1).toBe(true);

    const credits = await latestProviderCreditSnapshots(db.raw(), {
      provider: "xai",
    });
    const plan = credits.find((c) => c.source === "session_quota");
    expect(plan).toBeTruthy();
    expect(plan?.remaining).toBe(47); // 100 - 53
    expect(plan?.unit).toBe("percent");
    expect(plan?.label).toContain("grok:week");
    expect(credits.some((c) => c.label === "plan_usage_unavailable")).toBe(
      false,
    );
  });
});

describe("credit normalize helpers", () => {
  test("normalizeOpenRouterCredits maps total_credits − total_usage", () => {
    const snaps = normalizeOpenRouterCredits({
      data: { total_credits: 100.5, total_usage: 25.75 },
    });
    expect(snaps).toHaveLength(1);
    expect(snaps[0].remaining).toBeCloseTo(74.75);
    expect(snaps[0].unit).toBe("usd");
    expect(snaps[0].surface).toBe("wallet");
    expect(snaps[0].source).toBe("provider_api");
  });

  test("normalizeOpenRouterCredits returns empty for unparseable payload", () => {
    expect(normalizeOpenRouterCredits({ foo: 1 })).toEqual([]);
  });

  test("anthropicCreditsUnavailable does not invent remaining", () => {
    const r = anthropicCreditsUnavailable("2026-07-01T00:00:00.000Z");
    expect(r.snapshots.every((s) => s.remaining == null)).toBe(true);
    expect(r.snapshots.some((s) => s.surface === "wallet")).toBe(true);
    expect(r.snapshots.some((s) => s.surface === "plan_usage")).toBe(true);
  });

  test("openaiWalletUnavailable is wallet surface", () => {
    const r = openaiWalletUnavailable();
    expect(r.snapshots[0].status).toBe("unavailable");
    expect(r.snapshots[0].surface).toBe("wallet");
  });

  test("xaiCreditsLimited is limited not ok", () => {
    const r = xaiCreditsLimited();
    const wallet = r.snapshots.find((s) => s.surface === "wallet");
    const plan = r.snapshots.find((s) => s.surface === "plan_usage");
    expect(wallet?.status).toBe("limited");
    expect(wallet?.remaining).toBeNull();
    expect(plan?.status).toBe("unavailable");
    expect(plan?.remaining).toBeNull();
  });

  test("normalizeSessionQuotaToCredits maps used_percent to remaining percent", () => {
    const snaps = normalizeSessionQuotaToCredits(
      [
        {
          source_id: "codex",
          instance_id: "local",
          timestamp: "2026-07-01T12:00:00Z",
          limit_id: "primary",
          used_percent: 25,
          window_minutes: 300,
          resets_at: "2026-07-01T17:00:00Z",
        },
      ],
      "openai",
    );
    expect(snaps[0].remaining).toBe(75);
    expect(snaps[0].unit).toBe("percent");
    expect(snaps[0].source).toBe("session_quota");
    expect(snaps[0].surface).toBe("plan_usage");
    expect(capacitySurfaceOf(snaps[0])).toBe("plan_usage");
    expect(snaps[0].details?.slot).toBe("5h");
    const missingWeek = snaps.find((s) => s.label === "quota_slot:wk");
    expect(missingWeek?.status).toBe("unavailable");
    expect(missingWeek?.remaining).toBeNull();
  });

  test("normalizeSessionQuotaToCredits fills Grok 5h as unavailable when only weekly exists", () => {
    const snaps = normalizeSessionQuotaToCredits(
      [
        {
          source_id: "grok",
          instance_id: "local",
          timestamp: "2026-08-13T12:00:00Z",
          limit_id: "grok:week",
          used_percent: 53,
          window_minutes: 10080,
          resets_at: "2026-08-17T02:53:15.569Z",
        },
      ],
      "xai",
    );
    const week = snaps.find((s) => s.details?.limitId === "grok:week");
    expect(week?.remaining).toBe(47);
    expect(week?.source).toBe("session_quota");
    expect(week?.details?.slot).toBe("wk");
    const fiveH = snaps.find((s) => s.label === "quota_slot:5h");
    expect(fiveH?.status).toBe("unavailable");
    expect(fiveH?.remaining).toBeNull();
    expect(fiveH?.details?.slot).toBe("5h");
    expect(fiveH?.details?.note).toMatch(/5-hour/i);
  });
});
