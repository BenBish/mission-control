/**
 * OpenCode session parser — ~/.local/share/opencode/opencode.db
 *
 * OpenCode (CLI + desktop) persists sessions, messages, and parts in a single
 * SQLite database (Drizzle schema). Authoritative fields verified against a
 * live local DB (session/message/part tables; 100+ sessions, 18k+ parts):
 *
 *  - `session` carries aggregate tokens/cost/model/title/directory.
 *  - `message.data` is JSON with role, tokens, cost, modelID, finish, etc.
 *  - `part.data` is JSON with type (tool|text|step-finish|…) and tool state.
 *
 * This is the **agent activity** source (`sourceId: "opencode"`). It is
 * distinct from the Hermes runtime backend label `"opencode"` on
 * `llama-toolbox-qwen-opencode.service` (inference health only) — see
 * `src/collectors/hermes/config.ts`.
 */

import type {
  ActivityPayload,
  IngestEvent,
  SessionPayload,
} from "../../types/ingest.js";
import { calculateCost, getPricing } from "../../types/pricing.js";

export interface OpenCodeSessionRow {
  id: string;
  directory: string;
  title: string;
  version: string;
  agent: string | null;
  model: string | null;
  cost: number;
  tokens_input: number;
  tokens_output: number;
  tokens_reasoning: number;
  tokens_cache_read: number;
  tokens_cache_write: number;
  time_created: number;
  time_updated: number;
  time_archived: number | null;
}

export interface OpenCodeMessageRow {
  id: string;
  session_id: string;
  time_created: number;
  time_updated: number;
  data: string;
}

export interface OpenCodePartRow {
  id: string;
  message_id: string;
  session_id: string;
  time_created: number;
  time_updated: number;
  data: string;
}

export interface OpenCodeSessionCounts {
  turnCount: number;
  toolCallCount: number;
  failureCount: number;
}

/** Watermark for one table: (time_updated, id) so LIMIT batches never skip ties. */
export interface OpenCodeTableCursor {
  updated: number;
  id: string;
}

export interface OpenCodeDbCursor {
  session: OpenCodeTableCursor;
  message: OpenCodeTableCursor;
  part: OpenCodeTableCursor;
}

export function emptyTableCursor(): OpenCodeTableCursor {
  return { updated: 0, id: "" };
}

export function emptyCursor(): OpenCodeDbCursor {
  return {
    session: emptyTableCursor(),
    message: emptyTableCursor(),
    part: emptyTableCursor(),
  };
}

/** Normalize legacy aggregate cursors that only stored numeric watermarks. */
export function normalizeCursor(raw: unknown): OpenCodeDbCursor {
  if (!raw || typeof raw !== "object") return emptyCursor();
  const r = raw as Record<string, unknown>;
  const table = (
    key: "session" | "message" | "part",
    legacyUpdatedKey: string,
  ): OpenCodeTableCursor => {
    const nested = r[key];
    if (nested && typeof nested === "object") {
      const n = nested as Record<string, unknown>;
      return {
        updated: typeof n.updated === "number" ? n.updated : 0,
        id: typeof n.id === "string" ? n.id : "",
      };
    }
    return {
      updated:
        typeof r[legacyUpdatedKey] === "number"
          ? (r[legacyUpdatedKey] as number)
          : 0,
      id: "",
    };
  };
  return {
    session: table("session", "sessionUpdated"),
    message: table("message", "messageUpdated"),
    part: table("part", "partUpdated"),
  };
}

/** True when row is strictly after the cursor in (time_updated, id) order. */
export function isAfterCursor(
  timeUpdated: number,
  id: string,
  cursor: OpenCodeTableCursor,
): boolean {
  if (timeUpdated > cursor.updated) return true;
  if (timeUpdated < cursor.updated) return false;
  return id > cursor.id;
}

export function advanceTableCursor(
  cursor: OpenCodeTableCursor,
  timeUpdated: number,
  id: string,
): OpenCodeTableCursor {
  if (isAfterCursor(timeUpdated, id, cursor)) {
    return { updated: timeUpdated, id };
  }
  return cursor;
}

export function toIso(ms: number | null | undefined): string | undefined {
  if (ms === undefined || ms === null || !Number.isFinite(ms) || ms <= 0) {
    return undefined;
  }
  return new Date(ms).toISOString();
}

export function parseModelField(model: string | null | undefined): {
  modelId?: string;
  providerId?: string;
} {
  if (!model) return {};
  const trimmed = model.trim();
  if (!trimmed) return {};
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as {
        id?: string;
        modelID?: string;
        providerID?: string;
        providerId?: string;
      };
      return {
        modelId: parsed.id ?? parsed.modelID,
        providerId: parsed.providerID ?? parsed.providerId,
      };
    } catch {
      return { modelId: trimmed };
    }
  }
  return { modelId: trimmed };
}

export function modelLabel(
  modelId: string | undefined,
  providerId: string | undefined,
): string | undefined {
  if (!modelId) return undefined;
  if (providerId) return `${providerId}/${modelId}`;
  return modelId;
}

function costFor(
  model: string | undefined,
  inputTokens: number,
  outputTokens: number,
  recordedCost?: number | null,
): number | undefined {
  if (recordedCost !== undefined && recordedCost !== null && recordedCost > 0) {
    return recordedCost;
  }
  if (!model) return undefined;
  const pricing = getPricing(model);
  if (
    pricing.inputCostPer1kTokens === 0 &&
    pricing.outputCostPer1kTokens === 0
  ) {
    return undefined;
  }
  const calculated = calculateCost(model, inputTokens, outputTokens);
  return calculated > 0 ? calculated : undefined;
}

export function sessionRowToPayload(
  row: OpenCodeSessionRow,
  counts: OpenCodeSessionCounts,
): SessionPayload {
  const { modelId, providerId } = parseModelField(row.model);
  const model = modelLabel(modelId, providerId);
  const inputTokens = row.tokens_input ?? 0;
  const outputTokens = row.tokens_output ?? 0;
  const costUsd = costFor(model, inputTokens, outputTokens, row.cost);

  return {
    externalId: row.id,
    cwd: row.directory || undefined,
    title: row.title || undefined,
    clientVersion: row.version || undefined,
    modelProvider: providerId,
    startedAt: toIso(row.time_created) ?? new Date().toISOString(),
    endedAt: toIso(row.time_archived ?? row.time_updated),
    turnCount: counts.turnCount,
    toolCallCount: counts.toolCallCount,
    failureCount: counts.failureCount,
    inputTokens,
    outputTokens,
    cacheReadTokens: row.tokens_cache_read ?? 0,
    cacheWriteTokens: row.tokens_cache_write ?? 0,
    costUsd,
  };
}

export function sessionToIngestEvent(
  row: OpenCodeSessionRow,
  counts: OpenCodeSessionCounts,
): IngestEvent {
  const payload = sessionRowToPayload(row, counts);
  return {
    kind: "session",
    naturalKey: `${row.id}@${payload.endedAt ?? ""}:${counts.turnCount}:${counts.toolCallCount}:${payload.inputTokens}:${payload.outputTokens}`,
    payload,
  };
}

interface ToolPartData {
  type?: string;
  tool?: string;
  callID?: string;
  state?: {
    status?: string;
    input?: unknown;
    output?: unknown;
    error?: string;
    title?: string;
    metadata?: unknown;
    time?: { start?: number; end?: number };
  };
}

interface MessageData {
  role?: string;
  agent?: string;
  mode?: string;
  modelID?: string;
  providerID?: string;
  cost?: number;
  finish?: string;
  tokens?: {
    total?: number;
    input?: number;
    output?: number;
    reasoning?: number;
    cache?: { read?: number; write?: number };
  };
  time?: { created?: number; completed?: number };
  path?: { cwd?: string; root?: string };
  model?: { providerID?: string; modelID?: string };
}

function toolStatus(raw: string | undefined): string {
  const status = raw?.toLowerCase();
  if (status === "completed" || status === "complete" || status === "success") {
    return "success";
  }
  if (status === "error" || status === "failed" || status === "failure") {
    return "failure";
  }
  if (status === "pending" || status === "running") return "running";
  if (status === "cancelled" || status === "canceled") return "cancelled";
  return status ?? "success";
}

function textSnippet(value: unknown, max = 500): string {
  if (typeof value === "string") return value.slice(0, max);
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  for (const key of ["text", "description", "command", "pattern", "path"]) {
    const snippet = textSnippet(record[key], max);
    if (snippet) return snippet;
  }
  try {
    return JSON.stringify(value).slice(0, max);
  } catch {
    return "";
  }
}

export function parseToolPart(row: OpenCodePartRow): IngestEvent | null {
  let data: ToolPartData;
  try {
    data = JSON.parse(row.data) as ToolPartData;
  } catch {
    return null;
  }
  if (data.type !== "tool") return null;

  const status = toolStatus(data.state?.status);
  const toolName = data.tool;
  const callId = data.callID ?? row.id;
  const startMs = data.state?.time?.start ?? row.time_created;
  const endMs = data.state?.time?.end ?? row.time_updated;
  const durationMs =
    startMs && endMs && endMs >= startMs ? endMs - startMs : undefined;
  const title = data.state?.title;
  const description =
    title ||
    textSnippet(data.state?.input) ||
    (toolName
      ? status === "running"
        ? `${toolName} started`
        : toolName
      : "Tool call");

  const activity: ActivityPayload = {
    sessionExternalId: row.session_id,
    externalId: callId,
    parentExternalId: row.message_id,
    timestamp: toIso(startMs) ?? new Date().toISOString(),
    completedAt: status === "running" ? undefined : toIso(endMs),
    durationMs,
    actorType: "agent",
    actorId: "opencode",
    actionType: "tool_call",
    toolName,
    description,
    status,
    result:
      status === "failure"
        ? (data.state?.error ?? data.state?.output)
        : data.state?.output !== undefined
          ? textSnippet(data.state.output, 2000)
          : undefined,
    details: {
      partId: row.id,
      callID: callId,
      input: data.state?.input,
      error: data.state?.error,
      metadata: data.state?.metadata,
    },
  };

  return {
    kind: "activity",
    naturalKey: `opencode:part:${row.id}:${status}`,
    payload: activity,
  };
}

export function parseMessage(
  row: OpenCodeMessageRow,
  userText?: string,
): IngestEvent | null {
  let data: MessageData;
  try {
    data = JSON.parse(row.data) as MessageData;
  } catch {
    return null;
  }

  const role = data.role?.toLowerCase();
  const modelId = data.modelID ?? data.model?.modelID;
  const providerId = data.providerID ?? data.model?.providerID;
  const model = modelLabel(modelId, providerId);
  const created =
    toIso(data.time?.created ?? row.time_created) ?? new Date().toISOString();

  if (role === "user") {
    const description =
      (userText && userText.trim().slice(0, 500)) || "User message";
    const activity: ActivityPayload = {
      sessionExternalId: row.session_id,
      externalId: row.id,
      timestamp: created,
      actorType: "user",
      actorId: "user",
      actionType: "user_request",
      description,
      status: "success",
      model,
      details: {
        agent: data.agent,
        path: data.path,
      },
    };
    return {
      kind: "activity",
      naturalKey: `opencode:message:${row.id}:user`,
      payload: activity,
    };
  }

  if (role === "assistant") {
    const tokens = data.tokens;
    const inputTokens = tokens?.input ?? 0;
    const outputTokens = tokens?.output ?? 0;
    const cacheReadTokens = tokens?.cache?.read ?? 0;
    const cacheWriteTokens = tokens?.cache?.write ?? 0;
    const totalTokens =
      tokens?.total ?? inputTokens + outputTokens + cacheReadTokens;
    const costUsd = costFor(model, inputTokens, outputTokens, data.cost);
    const completed = toIso(data.time?.completed ?? row.time_updated);
    const durationMs =
      data.time?.created && data.time?.completed
        ? Math.max(0, data.time.completed - data.time.created)
        : undefined;

    const finish = data.finish;
    const status =
      finish === "error" || finish === "failed"
        ? "failure"
        : finish === "cancelled" || finish === "canceled"
          ? "cancelled"
          : "success";

    const activity: ActivityPayload = {
      sessionExternalId: row.session_id,
      externalId: row.id,
      timestamp: created,
      completedAt: completed,
      durationMs,
      actorType: "agent",
      actorId: "opencode",
      actorRole: data.agent ?? data.mode,
      actionType: "message",
      description: `Assistant turn${model ? ` (${model})` : ""}${finish ? ` — ${finish}` : ""}`,
      status,
      inputTokens,
      outputTokens,
      totalTokens,
      cacheReadTokens,
      cacheWriteTokens,
      model,
      costUsd,
      details: {
        finish,
        reasoningTokens: tokens?.reasoning,
        agent: data.agent,
        mode: data.mode,
        path: data.path,
      },
    };

    return {
      kind: "activity",
      naturalKey: `opencode:message:${row.id}:assistant`,
      payload: activity,
    };
  }

  return null;
}

/** Extract a short user-visible text snippet from a text part's JSON data. */
export function textFromPartData(dataJson: string): string {
  try {
    const data = JSON.parse(dataJson) as {
      type?: string;
      text?: string;
      synthetic?: boolean;
    };
    if (data.type !== "text" || data.synthetic) return "";
    return typeof data.text === "string" ? data.text : "";
  } catch {
    return "";
  }
}
