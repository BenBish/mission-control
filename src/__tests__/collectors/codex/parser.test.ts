import { describe, expect, test } from "bun:test";
import {
  aggregateToSessionPayload,
  emptyAggregate,
  mergeSessionUpdate,
  parseCodexLine,
  sessionExternalIdFromPath,
  type CodexSessionAggregate,
} from "../../../collectors/codex/parser.js";
import type { ActivityPayload, SessionPayload } from "../../../types/ingest.js";

const SESSION_ID = "01a09322-9d50-72d2-bb3c-dc77b28f3f85";
const FILE_PATH = `/home/ben/.codex/sessions/2026/09/11/rollout-2026-09-11T18-01-54-${SESSION_ID}.jsonl`;

function line(record: unknown): string {
  return JSON.stringify(record);
}

describe("Codex parser — legacy CLI schema", () => {
  test("parses user_message/agent_message/function_call/token_count", () => {
    const userMsg = parseCodexLine(
      line({
        type: "event_msg",
        timestamp: "2026-09-11T18:01:55.000Z",
        payload: { type: "user_message", message: "hello" },
      }),
      FILE_PATH,
    );
    expect(userMsg?.turnDelta).toBe(1);
    expect((userMsg?.activity?.payload as ActivityPayload).actorType).toBe(
      "user",
    );
    expect((userMsg?.activity?.payload as ActivityPayload).description).toBe(
      "hello",
    );

    const toolCall = parseCodexLine(
      line({
        type: "response_item",
        timestamp: "2026-09-11T18:01:56.000Z",
        payload: {
          type: "function_call",
          name: "shell",
          call_id: "call-1",
          arguments: "{}",
        },
      }),
      FILE_PATH,
    );
    expect(toolCall?.toolCallDelta).toBe(1);

    const tokenCount = parseCodexLine(
      line({
        type: "event_msg",
        timestamp: "2026-09-11T18:01:57.000Z",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 100,
              output_tokens: 20,
              cached_input_tokens: 5,
            },
          },
          rate_limits: {
            limit_id: "codex",
            primary: {
              used_percent: 42,
              window_minutes: 300,
              resets_at: 1789200000,
            },
          },
        },
      }),
      FILE_PATH,
    );
    expect(tokenCount?.sessionUpdate?.inputTokens).toBe(100);
    expect(tokenCount?.quotaSnapshots).toHaveLength(1);
    expect(tokenCount?.quotaSnapshots?.[0].payload).toMatchObject({
      limitId: "codex:primary",
      usedPercent: 42,
    });
  });
});

describe("Codex parser — new CLI schema (BSH-372)", () => {
  test("item_completed/UserMessage becomes a user activity and a turn", () => {
    const parsed = parseCodexLine(
      line({
        type: "event_msg",
        timestamp: "2026-09-11T18:01:55.000Z",
        payload: {
          type: "item_completed",
          item: {
            type: "UserMessage",
            id: "item-1",
            content: [{ type: "text", text: "do the thing" }],
          },
        },
      }),
      FILE_PATH,
    );
    expect(parsed?.turnDelta).toBe(1);
    expect(parsed?.sessionUpdate?.endedAt).toBe("2026-09-11T18:01:55.000Z");
    const activity = parsed?.activity?.payload as ActivityPayload;
    expect(activity.actorType).toBe("user");
    expect(activity.actionType).toBe("user_request");
    expect(activity.description).toBe("do the thing");
  });

  test("item_completed/AgentMessage becomes an agent message activity", () => {
    const parsed = parseCodexLine(
      line({
        type: "event_msg",
        timestamp: "2026-09-11T18:02:00.000Z",
        payload: {
          type: "item_completed",
          item: {
            type: "AgentMessage",
            id: "item-2",
            content: [{ type: "Text", text: "done" }],
          },
        },
      }),
      FILE_PATH,
    );
    const activity = parsed?.activity?.payload as ActivityPayload;
    expect(activity.actorType).toBe("agent");
    expect(activity.actionType).toBe("message");
    expect(activity.description).toBe("done");
    expect(parsed?.turnDelta).toBeUndefined();
  });

  test("item_completed/CommandExecution becomes a tool_call, status reflects failure", () => {
    const ok = parseCodexLine(
      line({
        type: "event_msg",
        timestamp: "2026-09-11T18:02:05.000Z",
        payload: {
          type: "item_completed",
          item: {
            type: "CommandExecution",
            id: "exec-1",
            command: ["/bin/sh", "-lc", "ls"],
            cwd: "file:///home/ben/Dev/cloud-handoff",
            status: "completed",
          },
        },
      }),
      FILE_PATH,
    );
    expect(ok?.toolCallDelta).toBe(1);
    expect((ok?.activity?.payload as ActivityPayload).status).toBe("success");
    expect((ok?.activity?.payload as ActivityPayload).toolName).toBe("shell");

    const failed = parseCodexLine(
      line({
        type: "event_msg",
        timestamp: "2026-09-11T18:02:06.000Z",
        payload: {
          type: "item_completed",
          item: {
            type: "CommandExecution",
            id: "exec-2",
            command: ["/bin/sh", "-lc", "false"],
            status: "failed",
          },
        },
      }),
      FILE_PATH,
    );
    expect((failed?.activity?.payload as ActivityPayload).status).toBe(
      "failed",
    );
  });

  test("item_completed/CommandExecution tolerates a non-array command instead of throwing", () => {
    const parsed = parseCodexLine(
      line({
        type: "event_msg",
        timestamp: "2026-09-11T18:02:07.000Z",
        payload: {
          type: "item_completed",
          item: {
            type: "CommandExecution",
            id: "exec-malformed",
            command: "not-an-array",
            status: "completed",
          },
        },
      }),
      FILE_PATH,
    );
    expect((parsed?.activity?.payload as ActivityPayload).description).toBe(
      "(command)",
    );
  });

  test("item_completed/McpToolCall becomes a tool_call named server.tool", () => {
    const parsed = parseCodexLine(
      line({
        type: "event_msg",
        timestamp: "2026-09-11T18:02:10.000Z",
        payload: {
          type: "item_completed",
          item: {
            type: "McpToolCall",
            id: "exec-3",
            server: "linear",
            tool: "get_issue",
            status: "completed",
          },
        },
      }),
      FILE_PATH,
    );
    expect(parsed?.toolCallDelta).toBe(1);
    expect((parsed?.activity?.payload as ActivityPayload).toolName).toBe(
      "linear.get_issue",
    );
  });

  test("item_completed/FileChange becomes a tool_call listing changed files", () => {
    const parsed = parseCodexLine(
      line({
        type: "event_msg",
        timestamp: "2026-09-11T18:02:15.000Z",
        payload: {
          type: "item_completed",
          item: {
            type: "FileChange",
            id: "exec-4",
            changes: {
              "src/a.ts": { type: "update" },
              "src/b.ts": { type: "update" },
            },
          },
        },
      }),
      FILE_PATH,
    );
    expect(parsed?.toolCallDelta).toBe(1);
    const activity = parsed?.activity?.payload as ActivityPayload;
    expect(activity.toolName).toBe("apply_patch");
    expect(activity.description).toContain("src/a.ts");
    expect(activity.description).toContain("src/b.ts");
  });

  test("item_completed/Reasoning is dropped, like other content-free legacy types", () => {
    const parsed = parseCodexLine(
      line({
        type: "event_msg",
        timestamp: "2026-09-11T18:02:20.000Z",
        payload: {
          type: "item_completed",
          item: { type: "Reasoning", id: "r-1" },
        },
      }),
      FILE_PATH,
    );
    expect(parsed).toBeNull();
  });

  test("task_started/task_complete/turn_aborted keep endedAt moving without other data", () => {
    const started = parseCodexLine(
      line({
        type: "event_msg",
        timestamp: "2026-09-11T18:02:25.000Z",
        payload: { type: "task_started", turn_id: "turn-1" },
      }),
      FILE_PATH,
    );
    expect(started?.sessionUpdate).toEqual({
      endedAt: "2026-09-11T18:02:25.000Z",
    });
    expect(started?.activity).toBeUndefined();

    const aborted = parseCodexLine(
      line({
        type: "event_msg",
        timestamp: "2026-09-11T18:02:26.000Z",
        payload: {
          type: "turn_aborted",
          turn_id: "turn-1",
          reason: "interrupted",
        },
      }),
      FILE_PATH,
    );
    expect(aborted?.sessionUpdate).toEqual({
      endedAt: "2026-09-11T18:02:26.000Z",
    });
  });

  test("thread_settings_applied backfills modelProvider as a session_meta fallback", () => {
    const parsed = parseCodexLine(
      line({
        type: "event_msg",
        timestamp: "2026-09-11T18:02:27.000Z",
        payload: {
          type: "thread_settings_applied",
          thread_settings: {
            model: "gpt-5.6-sol",
            model_provider_id: "openai",
          },
        },
      }),
      FILE_PATH,
    );
    expect(parsed?.sessionUpdate).toEqual({ modelProvider: "openai" });

    const withoutProvider = parseCodexLine(
      line({
        type: "event_msg",
        timestamp: "2026-09-11T18:02:28.000Z",
        payload: { type: "thread_settings_applied", thread_settings: {} },
      }),
      FILE_PATH,
    );
    expect(withoutProvider).toBeNull();
  });

  test("token_usage_record maps thread_token_usage onto cumulative totals", () => {
    const parsed = parseCodexLine(
      line({
        type: "token_usage_record",
        ordinal: 42,
        timestamp: "2026-09-11T18:02:30.000Z",
        payload: {
          turn_id: "turn-1",
          thread_token_usage: {
            input_tokens: 5000,
            output_tokens: 300,
            cached_input_tokens: 1200,
            cache_write_input_tokens: 40,
          },
          turn_token_usage: {
            input_tokens: 100,
            output_tokens: 10,
          },
        },
      }),
      FILE_PATH,
    );
    expect(parsed?.sessionUpdate).toMatchObject({
      inputTokens: 5000,
      outputTokens: 300,
      cacheReadTokens: 1200,
      cacheWriteTokens: 40,
    });
    const activity = parsed?.activity?.payload as ActivityPayload;
    expect(activity).toMatchObject({
      externalId: `${FILE_PATH}:turn-1:token_usage`,
      actionType: "event",
      updateOnDuplicate: true,
      inputTokens: 100,
      outputTokens: 10,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    expect(activity.details).toEqual({ turnId: "turn-1" });
  });

  test("attributes each turn's usage to a deduplicable activity without changing cumulative totals", () => {
    const first = parseCodexLine(
      line({
        type: "token_usage_record",
        ordinal: 10,
        timestamp: "2026-09-11T18:02:30.000Z",
        payload: {
          thread_token_usage: { input_tokens: 1000, output_tokens: 100 },
          turn_token_usage: { input_tokens: 1000, output_tokens: 100 },
        },
      }),
      FILE_PATH,
    );
    const second = parseCodexLine(
      line({
        type: "token_usage_record",
        ordinal: 20,
        timestamp: "2026-09-11T18:03:30.000Z",
        payload: {
          thread_token_usage: { input_tokens: 1800, output_tokens: 160 },
          turn_token_usage: { input_tokens: 800, output_tokens: 60 },
        },
      }),
      FILE_PATH,
    );

    expect(first?.activity?.payload).toMatchObject({
      inputTokens: 1000,
      outputTokens: 100,
    });
    expect(second?.activity?.payload).toMatchObject({
      inputTokens: 800,
      outputTokens: 60,
    });
    expect(first?.activity?.naturalKey).not.toBe(second?.activity?.naturalKey);

    let agg = emptyAggregate(SESSION_ID);
    for (const parsed of [first, second]) {
      if (parsed?.sessionUpdate) {
        agg = mergeSessionUpdate(agg, parsed.sessionUpdate);
      }
    }
    expect(agg.inputTokens).toBe(1800);
    expect(agg.outputTokens).toBe(160);
  });

  test("a fully new-format session still closes out turns, tools and tokens", () => {
    const lines = [
      {
        type: "session_meta",
        timestamp: "2026-09-11T18:01:54.000Z",
        payload: { cwd: "/home/ben/Dev/cloud-handoff", cli_version: "0.153.4" },
      },
      {
        type: "event_msg",
        timestamp: "2026-09-11T18:01:55.000Z",
        payload: {
          type: "item_completed",
          item: {
            type: "UserMessage",
            id: "item-1",
            content: [{ type: "text", text: "fix the bug" }],
          },
        },
      },
      {
        type: "event_msg",
        timestamp: "2026-09-11T18:01:56.000Z",
        payload: {
          type: "item_completed",
          item: {
            type: "CommandExecution",
            id: "exec-1",
            command: ["/bin/sh", "-lc", "rg TODO"],
            status: "completed",
          },
        },
      },
      {
        type: "token_usage_record",
        timestamp: "2026-09-11T18:01:57.000Z",
        payload: {
          thread_token_usage: { input_tokens: 900, output_tokens: 50 },
        },
      },
      {
        type: "event_msg",
        timestamp: "2026-09-11T18:01:58.000Z",
        payload: {
          type: "item_completed",
          item: {
            type: "AgentMessage",
            id: "item-2",
            content: [{ type: "Text", text: "fixed it" }],
          },
        },
      },
      {
        type: "event_msg",
        timestamp: "2026-09-11T18:01:59.000Z",
        payload: { type: "task_complete", turn_id: "turn-1" },
      },
    ];

    let agg: CodexSessionAggregate = emptyAggregate(SESSION_ID);
    for (const record of lines) {
      const parsed = parseCodexLine(line(record), FILE_PATH);
      if (!parsed) continue;
      if (parsed.sessionUpdate) {
        agg = mergeSessionUpdate(
          agg,
          parsed.sessionUpdate,
          parsed.turnDelta ?? 0,
          parsed.toolCallDelta ?? 0,
        );
      }
    }

    const payload: SessionPayload = aggregateToSessionPayload(agg);
    expect(payload.turnCount).toBe(1);
    expect(payload.toolCallCount).toBe(1);
    expect(payload.inputTokens).toBe(900);
    expect(payload.outputTokens).toBe(50);
    expect(payload.endedAt).toBe("2026-09-11T18:01:59.000Z");
  });
});

describe("Codex parser — session id derivation", () => {
  test("still derives the session id from the rollout filename", () => {
    expect(sessionExternalIdFromPath(FILE_PATH)).toBe(SESSION_ID);
  });
});
