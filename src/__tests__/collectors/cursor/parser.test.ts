import { describe, expect, test } from "bun:test";
import {
  chatMetaToIngestEvent,
  classifyKvKey,
  composerToIngestEvent,
  decodeKvValue,
  normalizeToolStatus,
  parseBubble,
  parseBubbleKey,
  parseChatMetaJson,
  parseComposerData,
  parseStoreBlob,
  parseToolFormerData,
} from "../../../collectors/cursor/parser.js";
import type { ActivityPayload, SessionPayload } from "../../../types/ingest.js";

describe("classifyKvKey / parseBubbleKey", () => {
  test("classifies cursorDiskKV key prefixes", () => {
    expect(classifyKvKey("composerData:abc")).toBe("composer");
    expect(classifyKvKey("bubbleId:abc:def")).toBe("bubble");
    expect(classifyKvKey("toolFormerData:abc:1")).toBe("tool");
    expect(classifyKvKey("checkpointId:abc")).toBe("skip");
    expect(classifyKvKey("agentKv:req:1")).toBe("skip");
    expect(classifyKvKey("codeBlockDiff:x")).toBe("skip");
  });

  test("splits bubble keys into composer and bubble ids", () => {
    expect(parseBubbleKey("bubbleId:comp-1:bub-9")).toEqual({
      composerId: "comp-1",
      bubbleId: "bub-9",
    });
    expect(parseBubbleKey("bubbleId:")).toBeNull();
    expect(parseBubbleKey("bubbleId:comp-1:")).toBeNull();
  });
});

describe("decodeKvValue", () => {
  test("decodes JSON strings and buffers", () => {
    expect(decodeKvValue('{"a":1}')).toEqual({ a: 1 });
    expect(decodeKvValue(Buffer.from('{"b":2}'))).toEqual({ b: 2 });
  });

  test("returns null for non-JSON or malformed values", () => {
    expect(decodeKvValue("not json")).toBeNull();
    expect(decodeKvValue('{"truncated')).toBeNull();
    expect(decodeKvValue("")).toBeNull();
    expect(decodeKvValue(Buffer.from([0x08, 0x01, 0x12]))).toBeNull();
  });
});

describe("parseComposerData / composerToIngestEvent", () => {
  test("parses a composerData row into a session", () => {
    const composer = parseComposerData("composerData:c-1", {
      composerId: "c-1",
      name: "Fix cache invalidation",
      createdAt: 1_784_278_800_000,
      lastUpdatedAt: 1_784_278_802_000,
      status: "completed",
      unifiedMode: "agent",
    });
    expect(composer).toMatchObject({
      composerId: "c-1",
      name: "Fix cache invalidation",
      status: "completed",
      mode: "agent",
    });

    const event = composerToIngestEvent(composer!, {
      turnCount: 3,
      toolCallCount: 2,
      failureCount: 1,
    });
    expect(event.kind).toBe("session");
    const payload = event.payload as SessionPayload;
    expect(payload.externalId).toBe("c-1");
    expect(payload.title).toBe("Fix cache invalidation");
    expect(payload.startedAt).toBe("2026-07-17T09:00:00.000Z");
    expect(payload.endedAt).toBe("2026-07-17T09:00:02.000Z");
    expect(payload.turnCount).toBe(3);
    expect(payload.costUsd).toBeUndefined();
    expect(payload.inputTokens).toBeUndefined();
  });

  test("falls back to the key suffix for the composer id", () => {
    const composer = parseComposerData("composerData:c-9", {
      createdAt: 1_784_278_800_000,
    });
    expect(composer?.composerId).toBe("c-9");
  });

  test("leaves endedAt unset while generating", () => {
    const composer = parseComposerData("composerData:c-2", {
      createdAt: 1_784_278_800_000,
      lastUpdatedAt: 1_784_278_802_000,
      status: "generating",
    });
    const event = composerToIngestEvent(composer!, {
      turnCount: 1,
      toolCallCount: 0,
      failureCount: 0,
    });
    expect((event.payload as SessionPayload).endedAt).toBeUndefined();
  });

  test("rejects non-object values", () => {
    expect(parseComposerData("composerData:x", null)).toBeNull();
    expect(parseComposerData("composerData:x", "str")).toBeNull();
  });
});

describe("parseBubble", () => {
  test("type 1 bubble becomes a user_request activity", () => {
    const result = parseBubble("bubbleId:c-1:b-1", {
      type: 1,
      text: "Why is this stale?",
      createdAt: 1_784_278_801_000,
      workspaceProjectDir: "/work/api",
    });
    expect(result).not.toBeNull();
    const p = result!.event.payload as ActivityPayload;
    expect(p.sessionExternalId).toBe("c-1");
    expect(p.actorType).toBe("user");
    expect(p.actionType).toBe("user_request");
    expect(p.description).toBe("Why is this stale?");
    expect(p.timestamp).toBe("2026-07-17T09:00:01.000Z");
    expect(result!.event.naturalKey).toBe("cursor:bubble:c-1:b-1");
  });

  test("non-user bubble becomes an assistant message", () => {
    const result = parseBubble("bubbleId:c-1:b-2", {
      type: 2,
      rawText: "Because the index lags.",
      timestamp: 1_784_278_803_000,
      modelInfo: { modelName: "claude-sonnet-4" },
    });
    const p = result!.event.payload as ActivityPayload;
    expect(p.actorType).toBe("agent");
    expect(p.actorId).toBe("cursor");
    expect(p.actionType).toBe("message");
    expect(p.model).toBe("claude-sonnet-4");
  });

  test("bubble carrying toolFormerData becomes a tool_call", () => {
    const result = parseBubble("bubbleId:c-1:b-3", {
      type: 2,
      createdAt: 1_784_278_804_000,
      toolFormerData: { name: "read_file", status: "completed" },
    });
    const p = result!.event.payload as ActivityPayload;
    expect(p.actionType).toBe("tool_call");
    expect(p.toolName).toBe("read_file");
    expect(p.status).toBe("success");
  });

  test("rejects malformed keys and non-object values", () => {
    expect(parseBubble("bubbleId:", {})).toBeNull();
    expect(parseBubble("bubbleId:c:b", null)).toBeNull();
    expect(parseBubble("bubbleId:c:b", "nope")).toBeNull();
  });
});

describe("parseToolFormerData", () => {
  test("emits a tool_call attributed to the composer from the key", () => {
    const event = parseToolFormerData("toolFormerData:c-1:call-7", {
      name: "run_terminal_cmd",
      status: "completed",
      params: { command: "ls" },
      result: { output: "ok" },
    });
    expect(event).not.toBeNull();
    const p = event!.payload as ActivityPayload;
    expect(p.sessionExternalId).toBe("c-1");
    expect(p.actionType).toBe("tool_call");
    expect(p.toolName).toBe("run_terminal_cmd");
    expect(p.status).toBe("success");
    expect(event!.naturalKey).toBe("cursor:tool:call-7:success");
  });

  test("marks failures and includes the error", () => {
    const event = parseToolFormerData("toolFormerData:c-1:call-8", {
      tool: "edit_file",
      status: "error",
      error: "write failed",
    });
    const p = event!.payload as ActivityPayload;
    expect(p.status).toBe("failure");
    expect(p.result).toBe("write failed");
    expect(event!.naturalKey).toContain(":failure");
  });

  test("skips rows with no resolvable session", () => {
    expect(parseToolFormerData("toolFormerData:", { name: "x" })).toBeNull();
    expect(parseToolFormerData("toolFormerData:", null)).toBeNull();
  });
});

describe("normalizeToolStatus", () => {
  test("maps Cursor-ish statuses onto ingest statuses", () => {
    expect(normalizeToolStatus("completed")).toBe("success");
    expect(normalizeToolStatus("error")).toBe("failure");
    expect(normalizeToolStatus("generating")).toBe("running");
    expect(normalizeToolStatus("aborted")).toBe("cancelled");
    expect(normalizeToolStatus(undefined)).toBe("success");
  });
});

describe("parseStoreBlob / parseChatMetaJson", () => {
  test("JSON user blob becomes a user_request", () => {
    const event = parseStoreBlob("sess-1", {
      rowid: 1,
      id: "blob-1",
      data: JSON.stringify({
        role: "user",
        text: "hello",
        timestamp: 1_784_278_800_000,
      }),
    });
    const p = event!.payload as ActivityPayload;
    expect(p.sessionExternalId).toBe("sess-1");
    expect(p.actionType).toBe("user_request");
    expect(event!.naturalKey).toBe("cursor:store:sess-1:blob-1");
  });

  test("JSON tool blob becomes a tool_call; assistant becomes a message", () => {
    const tool = parseStoreBlob("sess-1", {
      rowid: 2,
      id: "blob-2",
      data: JSON.stringify({ role: "tool", name: "grep", status: "error" }),
    });
    expect((tool!.payload as ActivityPayload).actionType).toBe("tool_call");
    expect((tool!.payload as ActivityPayload).status).toBe("failure");

    const asst = parseStoreBlob("sess-1", {
      rowid: 3,
      id: "blob-3",
      data: JSON.stringify({ role: "assistant", text: "done", model: "gpt-5" }),
    });
    expect((asst!.payload as ActivityPayload).actionType).toBe("message");
    expect((asst!.payload as ActivityPayload).model).toBe("gpt-5");
  });

  test("non-JSON (protobuf) and unroled blobs are skipped", () => {
    expect(
      parseStoreBlob("s", {
        rowid: 1,
        id: "p",
        data: Buffer.from([0x0a, 0x05]),
      }),
    ).toBeNull();
    expect(
      parseStoreBlob("s", { rowid: 2, id: "q", data: '{"kind":"turnGraph"}' }),
    ).toBeNull();
  });

  test("meta.json parses and produces a session event", () => {
    const meta = parseChatMetaJson(
      JSON.stringify({
        title: "CLI fix",
        createdAtMs: 1_784_278_800_000,
        updatedAtMs: 1_784_278_900_000,
      }),
    );
    expect(meta).toMatchObject({ title: "CLI fix" });

    const event = chatMetaToIngestEvent(
      "sess-9",
      meta!,
      { turnCount: 2, toolCallCount: 1, failureCount: 0 },
      "/work/api",
    );
    const p = event.payload as SessionPayload;
    expect(p.externalId).toBe("sess-9");
    expect(p.cwd).toBe("/work/api");
    expect(p.title).toBe("CLI fix");
    expect(p.startedAt).toBe("2026-07-17T09:00:00.000Z");
    expect(p.endedAt).toBe("2026-07-17T09:01:40.000Z");
    expect(event.naturalKey).toContain("cursor:cli:sess-9@1784278900000");
  });

  test("malformed meta.json returns null", () => {
    expect(parseChatMetaJson("{oops")).toBeNull();
  });
});
