import { describe, expect, test } from "bun:test";
import {
  advanceTableCursor,
  emptyCursor,
  isAfterCursor,
  modelLabel,
  normalizeCursor,
  parseMessage,
  parseModelField,
  parseToolPart,
  sessionRowToPayload,
  sessionToIngestEvent,
  textFromPartData,
  toIso,
  type OpenCodeMessageRow,
  type OpenCodePartRow,
  type OpenCodeSessionRow,
} from "../../../collectors/opencode/parser.js";

const baseSession = (): OpenCodeSessionRow => ({
  id: "ses_test1",
  directory: "/home/ben/Dev/mission-control",
  title: "Wire OpenCode collector",
  version: "1.18.13",
  agent: "build",
  model: JSON.stringify({
    id: "Qwen3.6-35B-A3B-Opencode-128K",
    providerID: "llamaswap",
  }),
  cost: 0,
  tokens_input: 1000,
  tokens_output: 200,
  tokens_reasoning: 0,
  tokens_cache_read: 5000,
  tokens_cache_write: 0,
  time_created: 1_785_856_867_808,
  time_updated: 1_785_870_976_250,
  time_archived: null,
});

describe("OpenCode parser", () => {
  test("emptyCursor starts at zero watermarks", () => {
    expect(emptyCursor()).toEqual({
      session: { updated: 0, id: "" },
      message: { updated: 0, id: "" },
      part: { updated: 0, id: "" },
    });
  });

  test("normalizeCursor accepts legacy numeric watermarks", () => {
    expect(
      normalizeCursor({
        sessionUpdated: 10,
        messageUpdated: 20,
        partUpdated: 30,
      }),
    ).toEqual({
      session: { updated: 10, id: "" },
      message: { updated: 20, id: "" },
      part: { updated: 30, id: "" },
    });
  });

  test("compound table cursor orders by (updated, id)", () => {
    const cursor = { updated: 100, id: "b" };
    expect(isAfterCursor(101, "a", cursor)).toBe(true);
    expect(isAfterCursor(100, "c", cursor)).toBe(true);
    expect(isAfterCursor(100, "a", cursor)).toBe(false);
    expect(isAfterCursor(99, "z", cursor)).toBe(false);
    expect(advanceTableCursor(cursor, 100, "c")).toEqual({
      updated: 100,
      id: "c",
    });
  });

  test("toIso converts millisecond timestamps", () => {
    const ms = 1_785_856_867_808;
    expect(toIso(ms)).toBe(new Date(ms).toISOString());
    expect(toIso(undefined)).toBeUndefined();
    expect(toIso(0)).toBeUndefined();
  });

  test("parseModelField handles JSON and plain model ids", () => {
    expect(
      parseModelField(
        JSON.stringify({
          id: "Qwen3.6-35B-A3B-Opencode-128K",
          providerID: "llamaswap",
        }),
      ),
    ).toEqual({
      modelId: "Qwen3.6-35B-A3B-Opencode-128K",
      providerId: "llamaswap",
    });
    expect(parseModelField("plain-model")).toEqual({ modelId: "plain-model" });
    expect(parseModelField(null)).toEqual({});
    expect(modelLabel("m", "p")).toBe("p/m");
  });

  test("sessionRowToPayload maps aggregates and counts", () => {
    const payload = sessionRowToPayload(baseSession(), {
      turnCount: 3,
      toolCallCount: 7,
      failureCount: 1,
    });
    expect(payload.externalId).toBe("ses_test1");
    expect(payload.cwd).toBe("/home/ben/Dev/mission-control");
    expect(payload.title).toBe("Wire OpenCode collector");
    expect(payload.clientVersion).toBe("1.18.13");
    expect(payload.modelProvider).toBe("llamaswap");
    expect(payload.turnCount).toBe(3);
    expect(payload.toolCallCount).toBe(7);
    expect(payload.failureCount).toBe(1);
    expect(payload.inputTokens).toBe(1000);
    expect(payload.outputTokens).toBe(200);
    expect(payload.cacheReadTokens).toBe(5000);
    expect(payload.costUsd).toBeUndefined();
    expect(payload.startedAt).toBe(new Date(1_785_856_867_808).toISOString());
  });

  test("sessionToIngestEvent builds a stable naturalKey", () => {
    const event = sessionToIngestEvent(baseSession(), {
      turnCount: 2,
      toolCallCount: 1,
      failureCount: 0,
    });
    expect(event.kind).toBe("session");
    expect(event.naturalKey).toContain("ses_test1@");
    expect(event.naturalKey).toContain(":2:1:1000:200");
  });

  test("parseToolPart emits tool_call activities including failures", () => {
    const completed: OpenCodePartRow = {
      id: "prt_1",
      message_id: "msg_1",
      session_id: "ses_test1",
      time_created: 1_785_856_870_000,
      time_updated: 1_785_856_871_000,
      data: JSON.stringify({
        type: "tool",
        tool: "bash",
        callID: "call-abc",
        state: {
          status: "completed",
          title: "List files",
          input: { command: "ls" },
          output: "a\nb\n",
          time: { start: 1_785_856_870_000, end: 1_785_856_871_000 },
        },
      }),
    };
    const ok = parseToolPart(completed);
    expect(ok).not.toBeNull();
    expect(ok!.kind).toBe("activity");
    expect(ok!.payload).toMatchObject({
      sessionExternalId: "ses_test1",
      externalId: "call-abc",
      actorType: "agent",
      actorId: "opencode",
      actionType: "tool_call",
      toolName: "bash",
      status: "success",
      description: "List files",
    });

    const failed: OpenCodePartRow = {
      ...completed,
      id: "prt_2",
      data: JSON.stringify({
        type: "tool",
        tool: "glob",
        callID: "call-err",
        state: {
          status: "error",
          input: { pattern: "**/*" },
          error: "Permission denied",
          time: { start: 1_785_856_872_000, end: 1_785_856_873_000 },
        },
      }),
    };
    const err = parseToolPart(failed);
    expect(err!.payload).toMatchObject({
      status: "failure",
      toolName: "glob",
      result: "Permission denied",
    });
  });

  test("parseToolPart ignores non-tool parts", () => {
    const part: OpenCodePartRow = {
      id: "prt_text",
      message_id: "msg_1",
      session_id: "ses_test1",
      time_created: 1,
      time_updated: 1,
      data: JSON.stringify({ type: "text", text: "hi" }),
    };
    expect(parseToolPart(part)).toBeNull();
  });

  test("parseMessage handles user and assistant roles", () => {
    const user: OpenCodeMessageRow = {
      id: "msg_user",
      session_id: "ses_test1",
      time_created: 1_785_856_867_824,
      time_updated: 1_785_856_867_824,
      data: JSON.stringify({
        role: "user",
        time: { created: 1_785_856_867_824 },
        agent: "build",
        model: {
          providerID: "llamaswap",
          modelID: "Qwen3.6-35B-A3B-Opencode-128K",
        },
      }),
    };
    const userEvent = parseMessage(user, "Add OpenCode collector");
    expect(userEvent!.payload).toMatchObject({
      actorType: "user",
      actionType: "user_request",
      description: "Add OpenCode collector",
      status: "success",
    });

    const assistant: OpenCodeMessageRow = {
      id: "msg_asst",
      session_id: "ses_test1",
      time_created: 1_785_856_867_931,
      time_updated: 1_785_856_878_892,
      data: JSON.stringify({
        role: "assistant",
        agent: "build",
        modelID: "Qwen3.6-35B-A3B-Opencode-128K",
        providerID: "llamaswap",
        cost: 0,
        finish: "tool-calls",
        tokens: {
          total: 31486,
          input: 2469,
          output: 46,
          reasoning: 0,
          cache: { write: 0, read: 28971 },
        },
        time: { created: 1_785_856_867_931, completed: 1_785_856_878_892 },
      }),
    };
    const asstEvent = parseMessage(assistant);
    expect(asstEvent!.payload).toMatchObject({
      actorType: "agent",
      actorId: "opencode",
      actionType: "message",
      inputTokens: 2469,
      outputTokens: 46,
      cacheReadTokens: 28971,
      model: "llamaswap/Qwen3.6-35B-A3B-Opencode-128K",
      status: "success",
    });
  });

  test("textFromPartData skips synthetic text parts", () => {
    expect(
      textFromPartData(JSON.stringify({ type: "text", text: "hello" })),
    ).toBe("hello");
    expect(
      textFromPartData(
        JSON.stringify({ type: "text", text: "sys", synthetic: true }),
      ),
    ).toBe("");
  });
});
