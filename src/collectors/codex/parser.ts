/**
 * Codex JSONL parser — ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
 *
 * Field shapes verified against real files on this machine (63 files),
 * which turned out to differ from the design doc in two important ways:
 *
 *  1. user_message/agent_message/token_count are NOT top-level record
 *     types — they're nested as `{ type: 'event_msg', payload: { type:
 *     'user_message' | 'agent_message' | 'token_count' | ... , ... } }`.
 *     Likewise function_call/function_call_output are nested as
 *     `{ type: 'response_item', payload: { type: 'function_call', ... } }`.
 *  2. `rate_limits` is NOT an array — it's a single object per token_count
 *     record: `{ limit_id, primary: {used_percent, window_minutes,
 *     resets_at}, secondary: {...} }`. resets_at is a Unix timestamp in
 *     seconds, not an ISO string. Each token_count record with rate_limits
 *     present yields two quota_snapshot events (one per window), keyed
 *     `${limit_id}:primary` / `${limit_id}:secondary`. Those map onto the
 *     shared 5h / weekly plan-window contract in `src/lib/plan-windows.ts`
 *     (primary ≈ 5h, secondary ≈ weekly when window_minutes match).
 *  3. function_call has no turn_id field (the design doc's assumption was
 *     wrong) — it has `call_id`, which this parser uses for correlation
 *     instead.
 *
 * One session per file: unlike Claude Code, individual records don't carry
 * a session id. The filename itself encodes it —
 * `rollout-<timestamp>-<uuid>.jsonl` — and that uuid matches
 * session_meta.payload.id exactly (verified). Deriving it from the
 * filename (not from having seen the session_meta line first) means a
 * collector restart that resumes mid-file still knows which session it's
 * looking at.
 *
 * Simplification: function_call_output lines are not merged back onto
 * their originating function_call activity (would need call_id
 * correlation state across lines). function_call activities are emitted
 * with status 'success' unconditionally. A later pass could use call_id
 * matching or the exec_command_end/patch_apply_end event_msg records
 * (which do carry real exit/success signal) to fix this up — not done
 * here, same spirit as Claude Code's multi-tool-call simplification.
 *
 * Newer CLI schema (verified on 0.153.4, BSH-372): the CLI has been rolling
 * out a second, incompatible event shape that the four handlers above don't
 * recognize at all, so every line in it silently parsed to null. Sessions
 * seen dual-emitting both shapes still got partial data via the legacy
 * lines above; a session using only the new shape recorded nothing and got
 * stuck "Active" forever (no line ever touched endedAt). The new shape:
 *
 *  - `event_msg` → `item_completed`, wrapping a typed `item` rather than a
 *    flat payload: `UserMessage`/`AgentMessage` (content is an array of
 *    `{ type: 'text' | 'Text' | 'local_image', text? }` — casing differs
 *    between the two item types), `CommandExecution` (shell tool call,
 *    `status: 'completed' | 'failed'`), `McpToolCall` (`server`/`tool`,
 *    same status enum), `FileChange` (patch application, `changes: {
 *    [path]: {...} }`). `Reasoning`/`Extension`/`ContextCompaction` items
 *    carry no activity-worthy content and are dropped, same as this parser
 *    already drops several legacy event_msg types.
 *  - a new top-level `token_usage_record` type replaces `token_count` for
 *    token totals — `payload.thread_token_usage` is the cumulative-for-the-
 *    whole-session total (verified: grows monotonically across a session,
 *    unlike `turn_token_usage` which is per-turn). It does NOT carry
 *    `rate_limits` — plan-quota snapshots still depend on the legacy
 *    `token_count` event, which the CLI still emits alongside the new
 *    shape as of this writing but is not guaranteed to keep emitting.
 *  - `task_started`/`task_complete` bookend a turn; only used here to keep
 *    `endedAt` moving forward on sessions that otherwise emit only new-
 *    shape lines.
 */

import type {
  ActivityPayload,
  IngestEvent,
  SessionPayload,
} from "../../types/ingest.js";

export interface CodexSessionAggregate {
  externalId: string;
  cwd?: string;
  clientVersion?: string;
  modelProvider?: string;
  startedAt?: string;
  endedAt?: string;
  turnCount: number;
  toolCallCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export function emptyAggregate(externalId: string): CodexSessionAggregate {
  return {
    externalId,
    turnCount: 0,
    toolCallCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
}

export function aggregateToSessionPayload(
  agg: CodexSessionAggregate,
): SessionPayload {
  return {
    externalId: agg.externalId,
    cwd: agg.cwd,
    clientVersion: agg.clientVersion,
    modelProvider: agg.modelProvider ?? "openai",
    startedAt: agg.startedAt ?? new Date().toISOString(),
    endedAt: agg.endedAt,
    turnCount: agg.turnCount,
    toolCallCount: agg.toolCallCount,
    // Codex reports cumulative totals per token_count event, not deltas —
    // last value wins, so no addition here (see mergeSessionUpdate).
    inputTokens: agg.inputTokens,
    outputTokens: agg.outputTokens,
    cacheReadTokens: agg.cacheReadTokens,
    cacheWriteTokens: agg.cacheWriteTokens,
  };
}

/** session external_id from 'rollout-2026-05-03T17-07-45-<uuid>.jsonl' */
export function sessionExternalIdFromPath(filePath: string): string | null {
  const match = filePath.match(
    /rollout-[\d-]+T[\d-]+-([0-9a-f-]{36})\.jsonl$/i,
  );
  return match ? match[1] : null;
}

interface CodexRecord {
  timestamp?: string;
  type: string;
  payload?: Record<string, unknown>;
}

export interface ParsedLine {
  sessionExternalId: string;
  activity?: IngestEvent;
  quotaSnapshots?: IngestEvent[];
  /** Overwrite-style fields (cwd/version/provider) or cumulative totals (tokens) */
  sessionUpdate?: Partial<CodexSessionAggregate>;
  /** +1 per turn/tool-call this line represents, merged additively */
  turnDelta?: number;
  toolCallDelta?: number;
}

/** Joins `{ text }` elements from a content array, tolerating the type-name
 * casing difference between item kinds (UserMessage: 'text', AgentMessage:
 * 'Text') by keying off the field's presence rather than the type tag. */
function extractItemText(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  const parts = content
    .map((el) => (el as { text?: unknown })?.text)
    .filter((t): t is string => typeof t === "string");
  return parts.length > 0 ? parts.join("\n") : undefined;
}

function parseItemCompleted(
  record: CodexRecord,
  sessionExternalId: string,
  filePath: string,
  timestamp: string,
): ParsedLine | null {
  const item = (record.payload?.item ?? {}) as Record<string, unknown>;
  const itemType = item.type as string | undefined;
  const itemId = item.id as string | undefined;
  const naturalKey = `${filePath}:${itemId ?? timestamp}:${itemType}`;

  if (itemType === "UserMessage") {
    const activity: ActivityPayload = {
      sessionExternalId,
      externalId: naturalKey,
      timestamp,
      actorType: "user",
      actorId: "user",
      actionType: "user_request",
      description: (extractItemText(item.content) ?? "(no text)").slice(0, 500),
      status: "success",
    };
    return {
      sessionExternalId,
      turnDelta: 1,
      sessionUpdate: { endedAt: timestamp },
      activity: { kind: "activity", naturalKey, payload: activity },
    };
  }

  if (itemType === "AgentMessage") {
    const activity: ActivityPayload = {
      sessionExternalId,
      externalId: naturalKey,
      timestamp,
      actorType: "agent",
      actorId: "codex",
      actionType: "message",
      description: (extractItemText(item.content) ?? "(no text)").slice(0, 500),
      status: "success",
    };
    return {
      sessionExternalId,
      sessionUpdate: { endedAt: timestamp },
      activity: { kind: "activity", naturalKey, payload: activity },
    };
  }

  if (itemType === "CommandExecution") {
    const command = item.command as string[] | undefined;
    const status = item.status === "failed" ? "failed" : "success";
    const description = (command?.join(" ") ?? "(command)").slice(0, 500);
    const activity: ActivityPayload = {
      sessionExternalId,
      externalId: naturalKey,
      timestamp,
      actorType: "agent",
      actorId: "codex",
      actionType: "tool_call",
      toolName: "shell",
      description,
      status,
      details: { command, cwd: item.cwd },
    };
    return {
      sessionExternalId,
      toolCallDelta: 1,
      sessionUpdate: { endedAt: timestamp },
      activity: { kind: "activity", naturalKey, payload: activity },
    };
  }

  if (itemType === "McpToolCall") {
    const server = item.server as string | undefined;
    const tool = item.tool as string | undefined;
    const toolName = [server, tool].filter(Boolean).join(".") || "mcp_tool";
    const status = item.status === "failed" ? "failed" : "success";
    const activity: ActivityPayload = {
      sessionExternalId,
      externalId: naturalKey,
      timestamp,
      actorType: "agent",
      actorId: "codex",
      actionType: "tool_call",
      toolName,
      description: toolName,
      status,
      details: { arguments: item.arguments },
    };
    return {
      sessionExternalId,
      toolCallDelta: 1,
      sessionUpdate: { endedAt: timestamp },
      activity: { kind: "activity", naturalKey, payload: activity },
    };
  }

  if (itemType === "FileChange") {
    const changes = (item.changes ?? {}) as Record<string, unknown>;
    const files = Object.keys(changes);
    const activity: ActivityPayload = {
      sessionExternalId,
      externalId: naturalKey,
      timestamp,
      actorType: "agent",
      actorId: "codex",
      actionType: "tool_call",
      toolName: "apply_patch",
      description: `Updated ${files.length} file(s): ${files.join(", ")}`.slice(
        0,
        500,
      ),
      status: "success",
      details: { files },
    };
    return {
      sessionExternalId,
      toolCallDelta: 1,
      sessionUpdate: { endedAt: timestamp },
      activity: { kind: "activity", naturalKey, payload: activity },
    };
  }

  // Reasoning/Extension/ContextCompaction items carry no activity-worthy
  // content, same as the legacy parser dropping other event_msg types.
  return null;
}

export function parseCodexLine(
  line: string,
  filePath: string,
): ParsedLine | null {
  const sessionExternalId = sessionExternalIdFromPath(filePath);
  if (!sessionExternalId) return null;

  const record = JSON.parse(line) as CodexRecord;
  const timestamp = record.timestamp ?? new Date().toISOString();

  if (record.type === "session_meta") {
    const payload = record.payload as
      | {
          cwd?: string;
          cli_version?: string;
          model_provider?: string;
          timestamp?: string;
        }
      | undefined;
    return {
      sessionExternalId,
      sessionUpdate: {
        cwd: payload?.cwd,
        clientVersion: payload?.cli_version,
        modelProvider: payload?.model_provider,
        startedAt: payload?.timestamp ?? timestamp,
      },
    };
  }

  if (record.type === "event_msg") {
    const payloadType = record.payload?.type;

    if (payloadType === "user_message") {
      const message = record.payload?.message as string | undefined;
      const activity: ActivityPayload = {
        sessionExternalId,
        externalId: `${filePath}:${timestamp}:user_message`,
        timestamp,
        actorType: "user",
        actorId: "user",
        actionType: "user_request",
        description: (message ?? "(no text)").slice(0, 500),
        status: "success",
      };
      return {
        sessionExternalId,
        turnDelta: 1,
        sessionUpdate: { endedAt: timestamp },
        activity: {
          kind: "activity",
          naturalKey: `${filePath}:${timestamp}:user_message`,
          payload: activity,
        },
      };
    }

    if (payloadType === "agent_message") {
      const message = record.payload?.message as string | undefined;
      const activity: ActivityPayload = {
        sessionExternalId,
        externalId: `${filePath}:${timestamp}:agent_message`,
        timestamp,
        actorType: "agent",
        actorId: "codex",
        actionType: "message",
        description: (message ?? "(no text)").slice(0, 500),
        status: "success",
      };
      return {
        sessionExternalId,
        sessionUpdate: { endedAt: timestamp },
        activity: {
          kind: "activity",
          naturalKey: `${filePath}:${timestamp}:agent_message`,
          payload: activity,
        },
      };
    }

    if (payloadType === "token_count") {
      const info = record.payload?.info as
        | {
            total_token_usage?: {
              input_tokens?: number;
              output_tokens?: number;
              cached_input_tokens?: number;
            };
          }
        | null
        | undefined;
      const rateLimits = record.payload?.rate_limits as
        | {
            limit_id?: string;
            primary?: {
              used_percent?: number;
              window_minutes?: number;
              resets_at?: number;
            };
            secondary?: {
              used_percent?: number;
              window_minutes?: number;
              resets_at?: number;
            };
          }
        | null
        | undefined;

      const quotaSnapshots: IngestEvent[] = [];
      if (rateLimits?.limit_id) {
        for (const window of ["primary", "secondary"] as const) {
          const w = rateLimits[window];
          if (!w || w.used_percent === undefined) continue;
          quotaSnapshots.push({
            kind: "quota_snapshot",
            naturalKey: `${filePath}:${timestamp}:${window}`,
            payload: {
              timestamp,
              limitId: `${rateLimits.limit_id}:${window}`,
              usedPercent: w.used_percent,
              windowMinutes: w.window_minutes,
              resetsAt: w.resets_at
                ? new Date(w.resets_at * 1000).toISOString()
                : undefined,
            },
          });
        }
      }

      const sessionUpdate: Partial<CodexSessionAggregate> | undefined =
        info?.total_token_usage
          ? {
              inputTokens: info.total_token_usage.input_tokens ?? 0,
              outputTokens: info.total_token_usage.output_tokens ?? 0,
              cacheReadTokens: info.total_token_usage.cached_input_tokens ?? 0,
              endedAt: timestamp,
            }
          : { endedAt: timestamp };

      if (quotaSnapshots.length === 0 && !info?.total_token_usage) return null;

      return {
        sessionExternalId,
        sessionUpdate,
        quotaSnapshots: quotaSnapshots.length > 0 ? quotaSnapshots : undefined,
      };
    }

    if (payloadType === "task_started" || payloadType === "task_complete") {
      return { sessionExternalId, sessionUpdate: { endedAt: timestamp } };
    }

    if (payloadType === "item_completed") {
      return parseItemCompleted(record, sessionExternalId, filePath, timestamp);
    }

    return null;
  }

  if (record.type === "token_usage_record") {
    const usage = record.payload?.thread_token_usage as
      | {
          input_tokens?: number;
          output_tokens?: number;
          cached_input_tokens?: number;
          cache_write_input_tokens?: number;
        }
      | undefined;
    if (!usage) return null;

    return {
      sessionExternalId,
      sessionUpdate: {
        inputTokens: usage.input_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
        cacheReadTokens: usage.cached_input_tokens ?? 0,
        cacheWriteTokens: usage.cache_write_input_tokens ?? 0,
        endedAt: timestamp,
      },
    };
  }

  if (record.type === "response_item") {
    const payloadType = record.payload?.type;

    if (payloadType === "function_call") {
      const name = record.payload?.name as string | undefined;
      const callId = record.payload?.call_id as string | undefined;
      const args = record.payload?.arguments as string | undefined;
      const activity: ActivityPayload = {
        sessionExternalId,
        externalId: `${filePath}:${callId ?? timestamp}`,
        timestamp,
        actorType: "agent",
        actorId: "codex",
        actionType: "tool_call",
        toolName: name,
        description: name ?? "(tool call)",
        status: "success",
        details: { callId, arguments: args },
      };
      return {
        sessionExternalId,
        toolCallDelta: 1,
        sessionUpdate: { endedAt: timestamp },
        activity: {
          kind: "activity",
          naturalKey: `${filePath}:${callId ?? timestamp}`,
          payload: activity,
        },
      };
    }

    return null;
  }

  return null;
}

/**
 * Merge a line's session update onto the running aggregate. cwd/version/
 * provider/title are overwrite-style (last known value wins). Token
 * fields are themselves cumulative totals as reported by Codex
 * (total_token_usage), so the latest value wins rather than summing.
 * turnCount/toolCallCount are additive deltas.
 */
export function mergeSessionUpdate(
  agg: CodexSessionAggregate,
  update: Partial<CodexSessionAggregate>,
  turnDelta = 0,
  toolCallDelta = 0,
): CodexSessionAggregate {
  return {
    ...agg,
    cwd: update.cwd ?? agg.cwd,
    clientVersion: update.clientVersion ?? agg.clientVersion,
    modelProvider: update.modelProvider ?? agg.modelProvider,
    startedAt:
      !agg.startedAt || (update.startedAt && update.startedAt < agg.startedAt)
        ? (update.startedAt ?? agg.startedAt)
        : agg.startedAt,
    endedAt:
      !agg.endedAt || (update.endedAt && update.endedAt > agg.endedAt)
        ? (update.endedAt ?? agg.endedAt)
        : agg.endedAt,
    turnCount: agg.turnCount + turnDelta,
    toolCallCount: agg.toolCallCount + toolCallDelta,
    inputTokens: update.inputTokens ?? agg.inputTokens,
    outputTokens: update.outputTokens ?? agg.outputTokens,
    cacheReadTokens: update.cacheReadTokens ?? agg.cacheReadTokens,
    cacheWriteTokens: update.cacheWriteTokens ?? agg.cacheWriteTokens,
  };
}
