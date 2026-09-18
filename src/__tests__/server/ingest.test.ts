/**
 * Ingest API integration tests — covers the core correctness properties the
 * whole collector model depends on: validation, dedupe/idempotency, session
 * placeholder creation, session upsert-merge across repeated observations
 * (not additive double-counting), and SSE broadcast on new activities.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import express from "express";
import { Database } from "../../db/database.js";
import { setupRoutes } from "../../server/routes/index.js";
import {
  activityEvents,
  processIngestBatch,
} from "../../server/services/ingest-service.js";
import { getDailyConsumption } from "../../db/queries/consumption.js";
import { parseCodexLine } from "../../collectors/codex/parser.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { IngestBatch } from "../../types/ingest.js";

let fixtureDir: string;
let server: ReturnType<ReturnType<typeof express>["listen"]>;
let baseUrl: string;
let db: Database;

beforeAll(async () => {
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-ingest-"));
  db = new Database(path.join(fixtureDir, "test.db"));
  await db.initialize();

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

async function postBatch(batch: IngestBatch) {
  const res = await fetch(`${baseUrl}/api/ingest/batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(batch),
  });
  return { status: res.status, body: await res.json() };
}

describe("POST /api/ingest/batch", () => {
  test("accepts a session + activity event and rolls up onto the session", async () => {
    const batch: IngestBatch = {
      sourceId: "claude-code",
      instanceId: "claude-code@arch-desktop",
      collectorVersion: "test",
      sentAt: new Date().toISOString(),
      events: [
        {
          kind: "session",
          naturalKey: "sess-1@obs-1",
          payload: {
            externalId: "sess-1",
            cwd: "/home/ben/Dev/mission-control",
            startedAt: "2026-07-12T00:00:00.000Z",
            turnCount: 1,
            toolCallCount: 1,
            inputTokens: 100,
            outputTokens: 50,
          },
        },
        {
          kind: "activity",
          naturalKey: "sess-1:uuid-1",
          payload: {
            sessionExternalId: "sess-1",
            externalId: "uuid-1",
            timestamp: "2026-07-12T00:00:01.000Z",
            actorType: "agent",
            actorId: "claude",
            actionType: "tool_call",
            toolName: "Read",
            description: "Read a file",
            status: "success",
            inputTokens: 100,
            outputTokens: 50,
          },
        },
      ],
    };

    const { status, body } = await postBatch(batch);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.accepted).toBe(2);
    expect(body.duplicates).toBe(0);
    expect(body.rejected).toEqual([]);

    const sessionRes = await fetch(
      `${baseUrl}/api/sessions/claude-code:sess-1`,
    );
    const sessionBody = await sessionRes.json();
    expect(sessionRes.status).toBe(200);
    expect(sessionBody.session.stats.turnCount).toBe(1);
    expect(sessionBody.session.stats.inputTokens).toBe(100);
    expect(sessionBody.session.activities).toHaveLength(1);
    expect(sessionBody.session.activities[0].toolName).toBe("Read");
  });

  test("re-sending the exact same batch reports duplicates, not accepted", async () => {
    const batch: IngestBatch = {
      sourceId: "claude-code",
      instanceId: "claude-code@arch-desktop",
      collectorVersion: "test",
      sentAt: new Date().toISOString(),
      events: [
        {
          kind: "activity",
          naturalKey: "sess-1:uuid-2",
          payload: {
            sessionExternalId: "sess-1",
            externalId: "uuid-2",
            timestamp: "2026-07-12T00:00:02.000Z",
            actorType: "agent",
            actorId: "claude",
            actionType: "message",
            description: "A message",
            status: "success",
          },
        },
      ],
    };

    let broadcasts = 0;
    const onActivityCreated = () => {
      broadcasts++;
    };
    activityEvents.on("activity:created", onActivityCreated);
    try {
      const first = await postBatch(batch);
      expect(first.body.accepted).toBe(1);
      expect(first.body.duplicates).toBe(0);

      const replay = await postBatch(batch);
      expect(replay.body.accepted).toBe(0);
      expect(replay.body.duplicates).toBe(1);
      expect(broadcasts).toBe(1);
    } finally {
      activityEvents.off("activity:created", onActivityCreated);
    }
  });

  test("rejects empty activity external IDs so replay cannot create duplicate rows", async () => {
    const batch = {
      sourceId: "codex",
      instanceId: "codex@arch-desktop",
      collectorVersion: "test",
      sentAt: "2026-09-18T12:10:00.000Z",
      events: [
        {
          kind: "activity",
          naturalKey: "codex:empty-external-id",
          payload: {
            sessionExternalId: "sess-empty-external-id",
            externalId: "",
            timestamp: "2026-09-18T12:10:00.000Z",
            actorType: "agent",
            actorId: "codex",
            actionType: "event",
            description: "Invalid empty external ID",
            status: "success",
            inputTokens: 100,
            outputTokens: 10,
          },
        },
      ],
    } as IngestBatch;

    const first = await postBatch(batch);
    const replay = await postBatch(batch);
    expect(first.status).toBe(200);
    expect(first.body.accepted).toBe(0);
    expect(first.body.duplicates).toBe(0);
    expect(first.body.rejected).toHaveLength(1);
    expect(replay.status).toBe(200);
    expect(replay.body.accepted).toBe(0);
    expect(replay.body.duplicates).toBe(0);
    expect(replay.body.rejected).toHaveLength(1);

    const count = await db.raw().get<{
      count: number;
    }>(`SELECT COUNT(*) AS count FROM activities WHERE session_id = ?`, "codex:sess-empty-external-id");
    expect(count?.count).toBe(0);
  });

  test("re-applies a repeated Codex turn usage record to daily consumption", async () => {
    const filePath =
      "/tmp/rollout-2026-09-18T12-00-00-01a09322-9d50-72d2-bb3c-dc77b28f3f85.jsonl";
    const parsed = (
      inputTokens: number,
      outputTokens: number,
      ordinal: number,
    ) =>
      parseCodexLine(
        JSON.stringify({
          type: "token_usage_record",
          ordinal,
          timestamp: "2026-09-18T12:00:00.000Z",
          payload: {
            turn_id: "turn-repeated",
            turn_token_usage: {
              input_tokens: inputTokens,
              output_tokens: outputTokens,
            },
          },
        }),
        filePath,
      );
    const first = parsed(100, 10, 1)?.activity;
    const later = parsed(125, 12, 2)?.activity;
    expect(first).toBeDefined();
    expect(later).toBeDefined();
    expect(later?.naturalKey).toBe(first?.naturalKey);

    const batch = (event: NonNullable<typeof first>): IngestBatch => ({
      sourceId: "codex",
      instanceId: "codex@arch-desktop",
      collectorVersion: "test",
      sentAt: "2026-09-18T12:00:01.000Z",
      events: [event],
    });

    const initial = await processIngestBatch(db.raw(), batch(first!));
    const update = await processIngestBatch(db.raw(), batch(later!));
    expect(initial).toMatchObject({ accepted: 1, duplicates: 0, rejected: [] });
    expect(update).toMatchObject({ accepted: 0, duplicates: 1, rejected: [] });

    const rows = await getDailyConsumption(db.raw(), {
      since: "2026-09-18T00:00:00.000Z",
      sourceId: "codex",
    });
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          day: "2026-09-18",
          source_id: "codex",
          input_tokens: 125,
          output_tokens: 12,
        }),
      ]),
    );
  });

  test("re-observing a session merges counters instead of double-counting them", async () => {
    const observation = (
      turnCount: number,
      naturalKey: string,
    ): IngestBatch => ({
      sourceId: "claude-code",
      instanceId: "claude-code@arch-desktop",
      collectorVersion: "test",
      sentAt: new Date().toISOString(),
      events: [
        {
          kind: "session",
          naturalKey,
          payload: {
            externalId: "sess-2",
            startedAt: "2026-07-12T00:00:00.000Z",
            turnCount,
            inputTokens: turnCount * 10,
          },
        },
      ],
    });

    await postBatch(observation(1, "sess-2@obs-1"));
    await postBatch(observation(3, "sess-2@obs-2"));

    const res = await fetch(`${baseUrl}/api/sessions/claude-code:sess-2`);
    const body = await res.json();
    expect(body.session.stats.turnCount).toBe(3);
    expect(body.session.stats.inputTokens).toBe(30);
  });

  test("creates a placeholder session when an activity arrives before its session event", async () => {
    const batch: IngestBatch = {
      sourceId: "codex",
      instanceId: "codex@arch-desktop",
      collectorVersion: "test",
      sentAt: new Date().toISOString(),
      events: [
        {
          kind: "activity",
          naturalKey: "sess-early:uuid-1",
          payload: {
            sessionExternalId: "sess-early",
            externalId: "uuid-1",
            timestamp: "2026-07-12T00:00:00.000Z",
            actorType: "agent",
            actorId: "codex",
            actionType: "tool_call",
            description: "Tool call before session record",
            status: "success",
          },
        },
      ],
    };

    const { status, body } = await postBatch(batch);
    expect(status).toBe(200);
    expect(body.accepted).toBe(1);

    const res = await fetch(`${baseUrl}/api/sessions/codex:sess-early`);
    expect(res.status).toBe(200);
  });

  test("BSH-90: tool lifecycle reuses external_id and upserts status to success", async () => {
    const start: IngestBatch = {
      sourceId: "grok",
      instanceId: "grok@arch-desktop",
      collectorVersion: "test",
      sentAt: new Date().toISOString(),
      events: [
        {
          kind: "activity",
          naturalKey: "grok-tool:call-lifecycle:running",
          payload: {
            sessionExternalId: "sess-tool-lifecycle",
            externalId: "call-lifecycle-1",
            timestamp: "2026-08-04T12:00:00.000Z",
            actorType: "agent",
            actorId: "grok",
            actionType: "tool_call",
            toolName: "read_file",
            description: "read_file",
            status: "running",
          },
        },
      ],
    };
    const done: IngestBatch = {
      sourceId: "grok",
      instanceId: "grok@arch-desktop",
      collectorVersion: "test",
      sentAt: new Date().toISOString(),
      events: [
        {
          kind: "activity",
          naturalKey: "grok-tool:call-lifecycle:success",
          payload: {
            sessionExternalId: "sess-tool-lifecycle",
            externalId: "call-lifecycle-1",
            timestamp: "2026-08-04T12:00:01.000Z",
            completedAt: "2026-08-04T12:00:01.000Z",
            actorType: "agent",
            actorId: "grok",
            actionType: "tool_call",
            toolName: "read_file",
            description: "Read `/tmp/example`",
            status: "success",
          },
        },
      ],
    };

    const first = await postBatch(start);
    expect(first.status).toBe(200);
    expect(first.body.accepted).toBe(1);
    expect(first.body.rejected).toEqual([]);

    const second = await postBatch(done);
    expect(second.status).toBe(200);
    expect(second.body.accepted).toBe(1);
    expect(second.body.rejected).toEqual([]);

    const res = await fetch(`${baseUrl}/api/sessions/grok:sess-tool-lifecycle`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.session.activities).toHaveLength(1);
    expect(body.session.activities[0].status).toBe("success");
    expect(body.session.activities[0].externalId).toBe("call-lifecycle-1");
    expect(body.session.activities[0].completedAt).toBe(
      "2026-08-04T12:00:01.000Z",
    );
    // Start timestamp preserved; richer completion description preferred.
    expect(body.session.activities[0].timestamp).toBe(
      "2026-08-04T12:00:00.000Z",
    );
    // Path redaction (BSH-100) rewrites absolute paths in free text at ingest.
    expect(body.session.activities[0].description).toBe("Read `[PATH]`");
  });

  test("BSH-90: terminal status does not regress to running on late updates", async () => {
    const done: IngestBatch = {
      sourceId: "grok",
      instanceId: "grok@arch-desktop",
      collectorVersion: "test",
      sentAt: new Date().toISOString(),
      events: [
        {
          kind: "activity",
          naturalKey: "grok-tool:no-regress:success",
          payload: {
            sessionExternalId: "sess-no-regress",
            externalId: "call-no-regress",
            timestamp: "2026-08-04T12:00:00.000Z",
            completedAt: "2026-08-04T12:00:00.000Z",
            actorType: "agent",
            actorId: "grok",
            actionType: "tool_call",
            toolName: "run_terminal_command",
            description: "done",
            status: "success",
          },
        },
      ],
    };
    const lateRunning: IngestBatch = {
      sourceId: "grok",
      instanceId: "grok@arch-desktop",
      collectorVersion: "test",
      sentAt: new Date().toISOString(),
      events: [
        {
          kind: "activity",
          naturalKey: "grok-tool:no-regress:running-late",
          payload: {
            sessionExternalId: "sess-no-regress",
            externalId: "call-no-regress",
            timestamp: "2026-08-04T12:00:02.000Z",
            actorType: "agent",
            actorId: "grok",
            actionType: "tool_call",
            toolName: "run_terminal_command",
            description: "still going?",
            status: "running",
          },
        },
      ],
    };

    await postBatch(done);
    const second = await postBatch(lateRunning);
    expect(second.body.accepted).toBe(1);
    expect(second.body.rejected).toEqual([]);

    const res = await fetch(`${baseUrl}/api/sessions/grok:sess-no-regress`);
    const body = await res.json();
    expect(body.session.activities).toHaveLength(1);
    expect(body.session.activities[0].status).toBe("success");
  });

  test("rejects a single malformed event but still processes the rest of the batch", async () => {
    const batch = {
      sourceId: "claude-code",
      instanceId: "claude-code@arch-desktop",
      collectorVersion: "test",
      sentAt: new Date().toISOString(),
      events: [
        {
          kind: "activity",
          naturalKey: "bad-1",
          payload: { missingRequiredFields: true },
        },
        {
          kind: "activity",
          naturalKey: "sess-1:uuid-3",
          payload: {
            sessionExternalId: "sess-1",
            externalId: "uuid-3",
            timestamp: "2026-07-12T00:00:03.000Z",
            actorType: "agent",
            actorId: "claude",
            actionType: "message",
            description: "A valid activity after a bad one",
            status: "success",
          },
        },
      ],
    } as unknown as IngestBatch;

    const { status, body } = await postBatch(batch);
    expect(status).toBe(200);
    expect(body.accepted).toBe(1);
    expect(body.rejected).toHaveLength(1);
    expect(body.rejected[0].index).toBe(0);
  });
});

describe("POST /api/ingest/heartbeat", () => {
  test("updates a known source instance's status", async () => {
    const res = await fetch(`${baseUrl}/api/ingest/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceId: "lemonade",
        instanceId: "lemonade@strix-halo",
        status: "off",
        eventsEmitted: 0,
      }),
    });
    expect(res.status).toBe(200);

    const sources = await (await fetch(`${baseUrl}/api/sources`)).json();
    const lemonade = sources.sources.find(
      (s: { id: string }) => s.id === "lemonade",
    );
    const instance = lemonade.instances.find(
      (i: { id: string }) => i.id === "lemonade@strix-halo",
    );
    expect(instance.status).toBe("off");
    expect(instance.lastSeenAt).toBeTruthy();
  });

  test("rejects a heartbeat for an unknown instance", async () => {
    const res = await fetch(`${baseUrl}/api/ingest/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceId: "claude-code",
        instanceId: "claude-code@nonexistent-machine",
        status: "ok",
        eventsEmitted: 0,
      }),
    });
    expect(res.status).toBe(400);
  });
});
