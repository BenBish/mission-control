/**
 * Devin CLI session parser — ~/.local/share/devin/cli/sessions.db
 *
 * Devin CLI persists sessions, message nodes, and tool calls in a single
 * SQLite database. Authoritative fields verified against a live local DB:
 *
 *  - `sessions` carries id, working_directory, backend_type, model,
 *    agent_mode, created_at/last_activity_at (epoch seconds), title, and a
 *    metadata JSON blob with total_acu_cost/total_credit_cost (Devin meters
 *    in ACUs; both fields are 0 on this auth path but the schema exists).
 *  - `message_nodes.chat_message` is JSON: {message_id, role, content,
 *    tool_calls?, metadata{extensions["chisel/tool_call_timing"], ...}}.
 *    Roles seen: system | user | assistant | tool. `tool` nodes carry the
 *    tool_call_id plus timing/result metadata — they are the tool-activity
 *    source. Per-message token counts exist in the schema (num_tokens) but
 *    are always null — Devin does not expose token usage locally, so none
 *    of the payloads below fabricate token or USD figures.
 */

import type {
  ActivityPayload,
  IngestEvent,
  SessionPayload,
} from "../../types/ingest.js";

export interface DevinSessionRow {
  id: string;
  working_directory: string | null;
  backend_type: string | null;
  model: string | null;
  agent_mode: string | null;
  created_at: number;
  last_activity_at: number;
  title: string | null;
  hidden: number;
  metadata: string | null;
}

export interface DevinMessageNodeRow {
  row_id: number;
  session_id: string;
  node_id: number;
  parent_node_id: number | null;
  chat_message: string;
  created_at: number;
}

export interface DevinSessionCounts {
  turnCount: number;
  toolCallCount: number;
  failureCount: number;
}

/** Watermark for the sessions table: (last_activity_at, id) pair. */
export interface DevinSessionCursor {
  activity: number;
  id: string;
}

/**
 * message_nodes.row_id is AUTOINCREMENT and monotonic, so a single numeric
 * high-water mark is a safe cursor (unlike timestamped tables, no ties).
 */
export interface DevinDbCursor {
  session: DevinSessionCursor;
  messageRowId: number;
}

export function emptyCursor(): DevinDbCursor {
  return { session: { activity: 0, id: "" }, messageRowId: 0 };
}

export function normalizeCursor(raw: unknown): DevinDbCursor {
  if (!raw || typeof raw !== "object") return emptyCursor();
  const r = raw as Record<string, unknown>;
  const session =
    r.session && typeof r.session === "object"
      ? (r.session as Record<string, unknown>)
      : {};
  return {
    session: {
      activity: typeof session.activity === "number" ? session.activity : 0,
      id: typeof session.id === "string" ? session.id : "",
    },
    messageRowId: typeof r.messageRowId === "number" ? r.messageRowId : 0,
  };
}

export function isAfterSessionCursor(
  lastActivityAt: number,
  id: string,
  cursor: DevinSessionCursor,
): boolean {
  if (lastActivityAt > cursor.activity) return true;
  if (lastActivityAt < cursor.activity) return false;
  return id > cursor.id;
}

export function advanceSessionCursor(
  cursor: DevinSessionCursor,
  lastActivityAt: number,
  id: string,
): DevinSessionCursor {
  if (isAfterSessionCursor(lastActivityAt, id, cursor)) {
    return { activity: lastActivityAt, id };
  }
  return cursor;
}

/** sessions.created_at / last_activity_at are epoch seconds. */
export function toIso(seconds: number | null | undefined): string | undefined {
  if (
    seconds === undefined ||
    seconds === null ||
    !Number.isFinite(seconds) ||
    seconds <= 0
  ) {
    return undefined;
  }
  return new Date(seconds * 1000).toISOString();
}

export interface DevinSessionMetadata {
  totalAcuCost?: number;
  totalCreditCost?: number;
}

/**
 * Devin meters usage in ACUs (Agent Compute Units), not tokens or USD.
 * Parsed so callers can attach it to details — it is never mapped onto
 * costUsd or token fields.
 */
export function parseSessionMetadata(
  metadata: string | null,
): DevinSessionMetadata {
  if (!metadata) return {};
  try {
    const parsed = JSON.parse(metadata) as Record<string, unknown>;
    const out: DevinSessionMetadata = {};
    const acu = parsed.total_acu_cost;
    const credit = parsed.total_credit_cost;
    if (typeof acu === "number" && Number.isFinite(acu) && acu > 0) {
      out.totalAcuCost = acu;
    }
    if (typeof credit === "number" && Number.isFinite(credit) && credit > 0) {
      out.totalCreditCost = credit;
    }
    return out;
  } catch {
    return {};
  }
}

export function sessionRowToPayload(
  row: DevinSessionRow,
  counts: DevinSessionCounts,
): SessionPayload {
  return {
    externalId: row.id,
    cwd: row.working_directory || undefined,
    title: row.title || undefined,
    modelProvider: "devin",
    startedAt: toIso(row.created_at) ?? new Date().toISOString(),
    endedAt: toIso(row.last_activity_at),
    turnCount: counts.turnCount,
    toolCallCount: counts.toolCallCount,
    failureCount: counts.failureCount,
  };
}

export function sessionToIngestEvent(
  row: DevinSessionRow,
  counts: DevinSessionCounts,
): IngestEvent {
  const payload = sessionRowToPayload(row, counts);
  return {
    kind: "session",
    naturalKey: `${row.id}@${payload.endedAt ?? ""}:${counts.turnCount}:${counts.toolCallCount}:${counts.failureCount}`,
    payload,
  };
}

/**
 * sessions has no free-form column, so per-session ACU/credit totals ride on
 * an `event` activity whose details JSON is persisted. Emitted only when the
 * metadata reports a positive cost — the naturalKey embeds the values so a
 * changed cost re-emits while an unchanged one dedupes.
 */
export function sessionMetadataToIngestEvent(
  row: DevinSessionRow,
): IngestEvent | null {
  const meta = parseSessionMetadata(row.metadata);
  if (meta.totalAcuCost === undefined && meta.totalCreditCost === undefined) {
    return null;
  }
  const timestamp =
    toIso(row.last_activity_at) ??
    toIso(row.created_at) ??
    new Date().toISOString();
  const activity: ActivityPayload = {
    sessionExternalId: row.id,
    externalId: `${row.id}:usage-meta`,
    timestamp,
    actorType: "system",
    actorId: "devin",
    actionType: "event",
    description: "Devin session usage (ACU/credit totals)",
    status: "success",
    details: {
      totalAcuCost: meta.totalAcuCost,
      totalCreditCost: meta.totalCreditCost,
      unit: "acu",
    },
  };
  return {
    kind: "activity",
    naturalKey: `devin:session-meta:${row.id}:${meta.totalAcuCost ?? 0}:${meta.totalCreditCost ?? 0}`,
    payload: activity,
  };
}

interface DevinChatMessage {
  message_id?: string;
  role?: string;
  content?: unknown;
  tool_call_id?: string;
  tool_calls?: Array<{ id?: string; name?: string; index?: number }>;
  metadata?: {
    finish_reason?: string | null;
    created_at?: string | null;
    extensions?: {
      "chisel/tool_call_timing"?: {
        started_at?: string;
        finished_at?: string;
        duration_ms?: number;
      };
      "chisel/tool_result_meta"?: { success?: boolean; kind?: string };
    };
  };
}

function parseChatMessage(raw: string): DevinChatMessage | null {
  try {
    const data = JSON.parse(raw) as DevinChatMessage;
    return data && typeof data === "object" ? data : null;
  } catch {
    return null;
  }
}

function textSnippet(value: unknown, max = 500): string {
  if (typeof value === "string") return value.slice(0, max);
  if (value == null) return "";
  try {
    return JSON.stringify(value).slice(0, max);
  } catch {
    return "";
  }
}

/** Tool name from a tool_call_id like `exec_16#hash` or `skill_1#hash`. */
export function toolNameFromCallId(toolCallId: string): string | undefined {
  const idx = toolCallId.indexOf("_");
  if (idx <= 0) return undefined;
  return toolCallId.slice(0, idx);
}

function nodeTimestamp(
  row: DevinMessageNodeRow,
  msg: DevinChatMessage,
): string {
  const fromMeta = msg.metadata?.created_at;
  if (typeof fromMeta === "string") {
    const d = new Date(fromMeta);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return toIso(row.created_at) ?? new Date().toISOString();
}

/**
 * message_nodes row → activity event.
 *  - user → user_request with a content snippet
 *  - assistant → message turn (tool call names ride on details)
 *  - tool → tool_call activity (timing + success from chisel extensions)
 *  - system → skipped (environment/rules noise, not activity)
 */
export function parseMessageNode(row: DevinMessageNodeRow): IngestEvent | null {
  const msg = parseChatMessage(row.chat_message);
  if (!msg) return null;

  const role = msg.role?.toLowerCase();
  const timestamp = nodeTimestamp(row, msg);
  const externalId = msg.message_id ?? `${row.session_id}:${row.node_id}`;

  if (role === "user") {
    const activity: ActivityPayload = {
      sessionExternalId: row.session_id,
      externalId,
      timestamp,
      actorType: "user",
      actorId: "user",
      actionType: "user_request",
      description: textSnippet(msg.content) || "User message",
      status: "success",
      details: { nodeId: row.node_id },
    };
    return {
      kind: "activity",
      naturalKey: `devin:message:${externalId}:user`,
      payload: activity,
    };
  }

  if (role === "assistant") {
    const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
    const toolNames = toolCalls
      .map((t) => t?.name)
      .filter((n): n is string => typeof n === "string" && n !== "");
    const finish = msg.metadata?.finish_reason;
    const activity: ActivityPayload = {
      sessionExternalId: row.session_id,
      externalId,
      timestamp,
      actorType: "agent",
      actorId: "devin",
      actionType: "message",
      description:
        textSnippet(msg.content, 200) ||
        `Assistant turn${toolNames.length ? ` (${toolNames.join(", ")})` : ""}`,
      status: "success",
      details: {
        nodeId: row.node_id,
        finishReason: finish ?? undefined,
        toolCalls: toolCalls.map((t) => t?.id).filter(Boolean),
        toolNames: toolNames.length ? toolNames : undefined,
      },
    };
    return {
      kind: "activity",
      naturalKey: `devin:message:${externalId}:assistant`,
      payload: activity,
    };
  }

  if (role === "tool") {
    const timing = msg.metadata?.extensions?.["chisel/tool_call_timing"];
    const resultMeta = msg.metadata?.extensions?.["chisel/tool_result_meta"];
    const started =
      typeof timing?.started_at === "string"
        ? new Date(timing.started_at)
        : null;
    const finished =
      typeof timing?.finished_at === "string"
        ? new Date(timing.finished_at)
        : null;
    const status = resultMeta?.success === false ? "failure" : "success";
    const toolCallId = msg.tool_call_id;
    const activity: ActivityPayload = {
      sessionExternalId: row.session_id,
      externalId: toolCallId ?? externalId,
      parentExternalId: undefined,
      timestamp:
        started && !Number.isNaN(started.getTime())
          ? started.toISOString()
          : timestamp,
      completedAt:
        finished && !Number.isNaN(finished.getTime())
          ? finished.toISOString()
          : undefined,
      durationMs:
        typeof timing?.duration_ms === "number" &&
        Number.isFinite(timing.duration_ms)
          ? timing.duration_ms
          : undefined,
      actorType: "agent",
      actorId: "devin",
      actionType: "tool_call",
      toolName: toolCallId ? toolNameFromCallId(toolCallId) : undefined,
      description: toolCallId
        ? (toolNameFromCallId(toolCallId) ?? "Tool call")
        : "Tool result",
      status,
      result: textSnippet(msg.content, 2000) || undefined,
      details: {
        nodeId: row.node_id,
        toolCallId,
        resultKind: resultMeta?.kind,
      },
    };
    return {
      kind: "activity",
      naturalKey: `devin:tool:${activity.externalId}:${status}`,
      payload: activity,
    };
  }

  return null;
}
