/**
 * Claude Code JSONL parser — ~/.claude/projects/**\/*.jsonl
 *
 * Field shapes verified against real files on this machine (89 files,
 * spot-checked several projects), not just the design doc:
 *
 *  - Record shape varies by `type`. The ones this parser cares about:
 *    'user', 'assistant', 'custom-title', 'ai-title'. Everything else
 *    ('mode', 'permission-mode', 'file-history-snapshot', 'attachment',
 *    'last-prompt', 'pr-link', 'system', 'queue-operation', 'agent-name')
 *    is skipped for P1 — session/turn telemetry doesn't need them.
 *  - 'user' records: { parentUuid, isSidechain, uuid, sessionId, timestamp,
 *    cwd, gitBranch, version, message: { role: 'user', content } }.
 *    content is either a plain string (typed command / prompt) or an array
 *    that may contain `tool_result` blocks (the record reporting a tool's
 *    result back — these arrive with role 'user' even though they aren't
 *    human input) alongside an optional `toolUseResult` sibling field with
 *    { stdout, stderr, interrupted, isImage, noOutputExpected }.
 *  - 'assistant' records: same envelope fields, message.content is an
 *    array that may contain 'text'/'thinking'/'tool_use' blocks, plus
 *    message.model, message.usage.{input_tokens,output_tokens,
 *    cache_creation_input_tokens,cache_read_input_tokens}, and a
 *    top-level requestId.
 *  - No isSidechain:true records were found in this dataset (no subagent
 *    delegation in practice yet), but the field is honored regardless.
 *  - Session title comes from a later 'custom-title' or 'ai-title' record,
 *    not from the session-start record (there isn't a dedicated one —
 *    the first line is typically a 'mode' record).
 *
 * One simplification worth flagging: an assistant record's content array
 * can contain multiple tool_use blocks in principle. This parser emits one
 * activity per assistant record (actionType 'tool_call' if any tool_use is
 * present, using the first one's name; all tool_use ids are listed in
 * details.toolUseIds), not one activity per tool_use block. Multi-tool-call
 * turns are therefore undercounted as distinct tool_call activities — an
 * acceptable P1 simplification, not observed to matter in sampled data
 * (assistant records here all had at most one tool_use block).
 */

import type {
  ActionType,
  ActivityPayload,
  ActorType,
  IngestEvent,
  SessionPayload,
} from "../../types/ingest.js";

export interface ClaudeCodeSessionAggregate {
  externalId: string;
  cwd?: string;
  gitBranch?: string;
  title?: string;
  clientVersion?: string;
  startedAt?: string;
  endedAt?: string;
  turnCount: number;
  toolCallCount: number;
  failureCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export function emptyAggregate(externalId: string): ClaudeCodeSessionAggregate {
  return {
    externalId,
    turnCount: 0,
    toolCallCount: 0,
    failureCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
}

export function aggregateToSessionPayload(
  agg: ClaudeCodeSessionAggregate,
): SessionPayload {
  return {
    externalId: agg.externalId,
    cwd: agg.cwd,
    gitBranch: agg.gitBranch,
    title: agg.title,
    clientVersion: agg.clientVersion,
    modelProvider: "anthropic",
    startedAt: agg.startedAt ?? new Date().toISOString(),
    endedAt: agg.endedAt,
    turnCount: agg.turnCount,
    toolCallCount: agg.toolCallCount,
    failureCount: agg.failureCount,
    inputTokens: agg.inputTokens,
    outputTokens: agg.outputTokens,
    cacheReadTokens: agg.cacheReadTokens,
    cacheWriteTokens: agg.cacheWriteTokens,
  };
}

interface ContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  tool_use_id?: string;
  content?: unknown;
  [key: string]: unknown;
}

interface ClaudeCodeRecord {
  type: string;
  sessionId?: string;
  uuid?: string;
  parentUuid?: string | null;
  isSidechain?: boolean;
  timestamp?: string;
  cwd?: string;
  gitBranch?: string;
  version?: string;
  requestId?: string;
  toolUseResult?: {
    stdout?: string;
    stderr?: string;
    interrupted?: boolean;
    [key: string]: unknown;
  };
  message?: {
    role?: string;
    content?: string | ContentBlock[];
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
  customTitle?: string;
  aiTitle?: string;
}

export interface ParsedLine {
  activity?: IngestEvent;
  /** Fields to merge onto the running session aggregate for this line's session */
  sessionUpdate?: Partial<ClaudeCodeSessionAggregate>;
  sessionExternalId?: string;
}

function textOf(content: string | ContentBlock[] | undefined): string {
  if (!content) return "";
  if (typeof content === "string") return content.slice(0, 500);
  const text = content.find((c) => c.type === "text")?.text;
  return (text ?? "").slice(0, 500);
}

export function parseClaudeCodeLine(
  line: string,
  filePath: string,
): ParsedLine | null {
  const record = JSON.parse(line) as ClaudeCodeRecord;
  const sessionExternalId = record.sessionId;
  if (!sessionExternalId) return null;

  if (record.type === "custom-title" || record.type === "ai-title") {
    const title = record.customTitle ?? record.aiTitle;
    return { sessionExternalId, sessionUpdate: { title } };
  }

  if (record.type !== "user" && record.type !== "assistant") {
    return null;
  }
  if (!record.uuid || !record.timestamp) return null;

  const baseSessionUpdate: Partial<ClaudeCodeSessionAggregate> = {
    cwd: record.cwd,
    gitBranch: record.gitBranch,
    clientVersion: record.version,
    startedAt: record.timestamp,
    endedAt: record.timestamp,
  };

  if (record.type === "user") {
    const content = record.message?.content;
    const toolResultBlock =
      Array.isArray(content) && content.find((c) => c.type === "tool_result");

    if (toolResultBlock) {
      const status = record.toolUseResult?.interrupted
        ? "cancelled"
        : record.toolUseResult?.stderr
          ? "failure"
          : "success";

      const activity: ActivityPayload = {
        sessionExternalId,
        externalId: record.uuid,
        parentExternalId: record.parentUuid ?? undefined,
        timestamp: record.timestamp,
        actorType: "system",
        actorId: "tool-runtime",
        actionType: "tool_call",
        toolName: undefined,
        description: `Tool result for ${toolResultBlock.tool_use_id ?? "unknown"}`,
        status,
        details: { toolUseId: toolResultBlock.tool_use_id },
        result: record.toolUseResult,
      };

      return {
        sessionExternalId,
        sessionUpdate: {
          ...baseSessionUpdate,
          failureCount: status === "success" ? 0 : 1,
        },
        activity: {
          kind: "activity",
          naturalKey: `${filePath}:${record.uuid}`,
          payload: activity,
        },
      };
    }

    // Plain user turn (typed prompt / command)
    const activity: ActivityPayload = {
      sessionExternalId,
      externalId: record.uuid,
      parentExternalId: record.parentUuid ?? undefined,
      timestamp: record.timestamp,
      actorType: "user",
      actorId: "user",
      actionType: "user_request",
      description: textOf(content) || "(no text content)",
      status: "success",
    };

    return {
      sessionExternalId,
      sessionUpdate: { ...baseSessionUpdate, turnCount: 1 },
      activity: {
        kind: "activity",
        naturalKey: `${filePath}:${record.uuid}`,
        payload: activity,
      },
    };
  }

  // assistant record
  const content = record.message?.content;
  const toolUseBlocks = Array.isArray(content)
    ? content.filter((c) => c.type === "tool_use")
    : [];
  const usage = record.message?.usage;
  const actorType: ActorType = record.isSidechain ? "subagent" : "agent";
  const actionType: ActionType =
    toolUseBlocks.length > 0 ? "tool_call" : "message";

  const activity: ActivityPayload = {
    sessionExternalId,
    externalId: record.uuid,
    parentExternalId: record.parentUuid ?? undefined,
    timestamp: record.timestamp,
    actorType,
    actorId: actorType === "subagent" ? "subagent" : "assistant",
    actionType,
    toolName: toolUseBlocks[0]?.name,
    description:
      textOf(content) || (toolUseBlocks[0]?.name ?? "(assistant turn)"),
    status: "success",
    details:
      toolUseBlocks.length > 0
        ? { toolUseIds: toolUseBlocks.map((b) => b.id) }
        : undefined,
    inputTokens: usage?.input_tokens,
    outputTokens: usage?.output_tokens,
    cacheWriteTokens: usage?.cache_creation_input_tokens,
    cacheReadTokens: usage?.cache_read_input_tokens,
    totalTokens:
      (usage?.input_tokens ?? 0) +
      (usage?.output_tokens ?? 0) +
      (usage?.cache_creation_input_tokens ?? 0) +
      (usage?.cache_read_input_tokens ?? 0),
    model: record.message?.model,
    requestId: record.requestId,
  };

  return {
    sessionExternalId,
    sessionUpdate: {
      ...baseSessionUpdate,
      turnCount: 1,
      toolCallCount: toolUseBlocks.length,
      inputTokens: usage?.input_tokens ?? 0,
      outputTokens: usage?.output_tokens ?? 0,
      cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
      cacheWriteTokens: usage?.cache_creation_input_tokens ?? 0,
    },
    activity: {
      kind: "activity",
      naturalKey: `${filePath}:${record.uuid}`,
      payload: activity,
    },
  };
}

/**
 * Merge a line's partial session update onto the running aggregate.
 * Count/token fields are additive (each line contributes its own delta);
 * cwd/gitBranch/clientVersion/title are last-known-value overwrites;
 * startedAt takes the earliest, endedAt the latest.
 */
export function mergeSessionUpdate(
  agg: ClaudeCodeSessionAggregate,
  update: Partial<ClaudeCodeSessionAggregate>,
): ClaudeCodeSessionAggregate {
  return {
    ...agg,
    cwd: update.cwd ?? agg.cwd,
    gitBranch: update.gitBranch ?? agg.gitBranch,
    clientVersion: update.clientVersion ?? agg.clientVersion,
    title: update.title ?? agg.title,
    startedAt:
      !agg.startedAt || (update.startedAt && update.startedAt < agg.startedAt)
        ? (update.startedAt ?? agg.startedAt)
        : agg.startedAt,
    endedAt:
      !agg.endedAt || (update.endedAt && update.endedAt > agg.endedAt)
        ? (update.endedAt ?? agg.endedAt)
        : agg.endedAt,
    turnCount: agg.turnCount + (update.turnCount ?? 0),
    toolCallCount: agg.toolCallCount + (update.toolCallCount ?? 0),
    failureCount: agg.failureCount + (update.failureCount ?? 0),
    inputTokens: agg.inputTokens + (update.inputTokens ?? 0),
    outputTokens: agg.outputTokens + (update.outputTokens ?? 0),
    cacheReadTokens: agg.cacheReadTokens + (update.cacheReadTokens ?? 0),
    cacheWriteTokens: agg.cacheWriteTokens + (update.cacheWriteTokens ?? 0),
  };
}
