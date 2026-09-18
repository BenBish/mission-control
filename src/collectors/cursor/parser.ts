/**
 * Cursor session parser — state.vscdb cursorDiskKV + ~/.cursor store.db
 *
 * Cursor persists activity locally in two undocumented stacks (closed-source,
 * reverse-engineered; treat every field as optional):
 *
 *  1. IDE chats / composer sessions —
 *     `~/.config/Cursor/User/globalStorage/state.vscdb` (Linux; honors
 *     $XDG_CONFIG_HOME) and `~/Library/Application Support/Cursor/User/
 *     globalStorage/state.vscdb` (macOS). A SQLite KV store:
 *       - `cursorDiskKV` rows keyed `composerData:<composerId>` hold session
 *         headers (name, createdAt, lastUpdatedAt, status, unifiedMode).
 *       - `bubbleId:<composerId>:<bubbleId>` rows hold message bubbles
 *         (`type` 1 = user, anything else = assistant; text in `text` /
 *         `rawText`; ms epoch in `createdAt` / `timestamp`).
 *       - `toolFormerData:*` rows hold agent tool-call state on newer
 *         versions (name/status/params/result fields vary).
 *       - `checkpointId:*`, `codeBlockDiff:*`, `messageRequestContext:*`,
 *         `agentKv:*`, `ofsContent:*` etc. are skipped.
 *     `cursorDiskKV` has no updated column; callers should watermark on
 *     rowid, which moves forward on INSERT and on INSERT OR REPLACE.
 *
 *  2. cursor-agent CLI sessions — `~/.cursor/chats/<md5(abs workspace
 *     path)>/<session uuid>/store.db`, a SQLite db with `blobs(id, data)`
 *     (content-addressed; JSON blobs carry role user/assistant/tool
 *     messages, protobuf blobs carry the turn graph — non-JSON blobs are
 *     skipped) and `meta(key, value)`. Sibling `meta.json` carries title +
 *     createdAtMs/updatedAtMs. `workspace.json` files under
 *     `.../workspaceStorage/<id>/` map folders to their md5 bucket name.
 *
 * Cursor does not persist token counts or dollar costs locally — those
 * fields are left unset rather than estimated. Version/platform
 * assumptions above were reverse-engineered (Cursor 2.x–3.x); anything
 * absent or malformed is skipped, never fatal.
 */

import type {
  ActivityPayload,
  IngestEvent,
  SessionPayload,
} from "../../types/ingest.js";

// ---------------------------------------------------------------------------
// Shared row shapes (read via bun:sqlite in the collector)
// ---------------------------------------------------------------------------

export interface CursorKvRow {
  rowid: number;
  key: string;
  value: string | Uint8Array;
}

export interface CursorBlobRow {
  rowid: number;
  id: string;
  data: string | Uint8Array;
}

export interface CursorSessionCounts {
  turnCount: number;
  toolCallCount: number;
  failureCount: number;
}

// ---------------------------------------------------------------------------
// cursorDiskKV key classification
// ---------------------------------------------------------------------------

export type CursorKvKind = "composer" | "bubble" | "tool" | "skip";

export function classifyKvKey(key: string): CursorKvKind {
  if (key.startsWith("composerData:")) return "composer";
  if (key.startsWith("bubbleId:")) return "bubble";
  if (key.startsWith("toolFormerData:")) return "tool";
  return "skip";
}

/** `bubbleId:<composerId>:<bubbleId>` → [composerId, bubbleId] or null. */
export function parseBubbleKey(
  key: string,
): { composerId: string; bubbleId: string } | null {
  const rest = key.slice("bubbleId:".length);
  const sep = rest.indexOf(":");
  if (sep <= 0 || sep === rest.length - 1) return null;
  return { composerId: rest.slice(0, sep), bubbleId: rest.slice(sep + 1) };
}

// ---------------------------------------------------------------------------
// Value decoding
// ---------------------------------------------------------------------------

export function decodeKvValue(value: string | Uint8Array): unknown | null {
  const text =
    typeof value === "string" ? value : Buffer.from(value).toString("utf-8");
  const trimmed = text.trim();
  if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

export function toIso(ms: number | null | undefined): string | undefined {
  if (ms === undefined || ms === null || !Number.isFinite(ms) || ms <= 0) {
    return undefined;
  }
  return new Date(ms).toISOString();
}

function num(...values: unknown[]): number | undefined {
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (
      typeof v === "string" &&
      v.trim() !== "" &&
      Number.isFinite(Number(v))
    ) {
      return Number(v);
    }
  }
  return undefined;
}

function str(...values: unknown[]): string | undefined {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function textSnippet(value: unknown, max = 500): string {
  if (typeof value === "string") return value.slice(0, max);
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  for (const key of ["text", "description", "command", "path", "output"]) {
    const snippet = textSnippet(record[key], max);
    if (snippet) return snippet;
  }
  try {
    return JSON.stringify(value).slice(0, max);
  } catch {
    return "";
  }
}

export function normalizeToolStatus(raw: string | undefined): string {
  const status = raw?.toLowerCase();
  if (
    status === "completed" ||
    status === "complete" ||
    status === "success" ||
    status === "succeeded" ||
    status === "done"
  ) {
    return "success";
  }
  if (
    status === "error" ||
    status === "failed" ||
    status === "failure" ||
    status === "rejected"
  ) {
    return "failure";
  }
  if (status === "pending" || status === "running" || status === "generating") {
    return "running";
  }
  if (status === "cancelled" || status === "canceled" || status === "aborted") {
    return "cancelled";
  }
  return status ?? "success";
}

// ---------------------------------------------------------------------------
// composerData → session
// ---------------------------------------------------------------------------

export interface CursorComposer {
  composerId: string;
  name?: string;
  createdAt?: number;
  lastUpdatedAt?: number;
  status?: string;
  mode?: string;
}

export function parseComposerData(
  key: string,
  value: unknown,
): CursorComposer | null {
  if (!value || typeof value !== "object") return null;
  const d = value as Record<string, unknown>;
  const composerId =
    str(d.composerId, d.id) || key.slice("composerData:".length);
  if (!composerId) return null;
  return {
    composerId,
    name: str(d.name, d.title, d.subtitle),
    createdAt: num(d.createdAt, d.created_at, d.timestamp),
    lastUpdatedAt: num(d.lastUpdatedAt, d.last_updated_at, d.updatedAt),
    status: str(d.status),
    mode:
      str(d.unifiedMode, d.mode) ??
      (d.isAgentic === true ? "agent" : undefined),
  };
}

export function composerToIngestEvent(
  composer: CursorComposer,
  counts: CursorSessionCounts,
  cwd?: string,
): IngestEvent {
  const updated = composer.lastUpdatedAt ?? composer.createdAt ?? 0;
  const isActive =
    composer.status === "generating" || composer.status === "running";
  const payload: SessionPayload = {
    externalId: composer.composerId,
    cwd,
    title: composer.name || undefined,
    startedAt:
      toIso(composer.createdAt) ??
      toIso(composer.lastUpdatedAt) ??
      new Date().toISOString(),
    endedAt: isActive ? undefined : toIso(composer.lastUpdatedAt),
    turnCount: counts.turnCount,
    toolCallCount: counts.toolCallCount,
    failureCount: counts.failureCount,
  };
  return {
    kind: "session",
    naturalKey: `cursor:composer:${composer.composerId}@${updated}:${counts.turnCount}:${counts.toolCallCount}:${counts.failureCount}`,
    payload,
  };
}

// ---------------------------------------------------------------------------
// bubbleId → activity (user request / assistant message)
// ---------------------------------------------------------------------------

interface BubbleData {
  type?: number | string;
  text?: string;
  rawText?: string;
  createdAt?: number;
  timestamp?: number;
  modelInfo?: { modelName?: string };
  model?: string;
  toolFormerData?: Record<string, unknown>;
  workspaceProjectDir?: string;
}

export function parseBubble(
  key: string,
  value: unknown,
): { event: IngestEvent; composerId: string } | null {
  const ids = parseBubbleKey(key);
  if (!ids || !value || typeof value !== "object") return null;
  const d = value as BubbleData;

  const isUser = d.type === 1 || d.type === "1" || d.type === "user";
  const text = str(d.text, d.rawText);
  const ts = d.createdAt ?? d.timestamp;
  const model = str(d.model, d.modelInfo?.modelName);

  // A bubble that carries tool state is a tool call, not a message.
  const embeddedTool = d.toolFormerData;
  const isToolBubble =
    !isUser &&
    embeddedTool !== undefined &&
    typeof embeddedTool === "object" &&
    (typeof embeddedTool.name === "string" ||
      typeof embeddedTool.tool === "string");

  const activity: ActivityPayload = isToolBubble
    ? {
        sessionExternalId: ids.composerId,
        externalId: ids.bubbleId,
        timestamp: toIso(ts) ?? new Date().toISOString(),
        actorType: "agent",
        actorId: "cursor",
        actionType: "tool_call",
        toolName: str(embeddedTool.name, embeddedTool.tool),
        description: str(embeddedTool.name, embeddedTool.tool) ?? "Tool call",
        status: normalizeToolStatus(str(embeddedTool.status as string)),
        details: { toolFormerData: embeddedTool },
      }
    : isUser
      ? {
          sessionExternalId: ids.composerId,
          externalId: ids.bubbleId,
          timestamp: toIso(ts) ?? new Date().toISOString(),
          actorType: "user",
          actorId: "user",
          actionType: "user_request",
          description: text?.slice(0, 500) || "User message",
          status: "success",
          model,
          details: {
            bubbleType: d.type,
            workspaceProjectDir: d.workspaceProjectDir,
          },
        }
      : {
          sessionExternalId: ids.composerId,
          externalId: ids.bubbleId,
          timestamp: toIso(ts) ?? new Date().toISOString(),
          actorType: "agent",
          actorId: "cursor",
          actionType: "message",
          description:
            text?.slice(0, 500) ||
            `Assistant message${model ? ` (${model})` : ""}`,
          status: "success",
          model,
          details: { bubbleType: d.type },
        };

  return {
    event: {
      kind: "activity",
      naturalKey: `cursor:bubble:${ids.composerId}:${ids.bubbleId}`,
      payload: activity,
    },
    composerId: ids.composerId,
  };
}

// ---------------------------------------------------------------------------
// toolFormerData → tool_call activity
// ---------------------------------------------------------------------------

export function parseToolFormerData(
  key: string,
  value: unknown,
): IngestEvent | null {
  if (!value || typeof value !== "object") return null;
  const d = value as Record<string, unknown>;

  // Key is usually `toolFormerData:<composerId>:<callId>`; fall back to
  // session-ish fields on the record itself.
  const keyParts = key.slice("toolFormerData:".length).split(":");
  const composerId = str(
    d.composerId,
    d.chatId,
    d.sessionId,
    keyParts.length >= 2 ? keyParts[0] : undefined,
  );
  if (!composerId) return null;

  const toolName = str(d.name, d.toolName, d.tool);
  const status = normalizeToolStatus(
    str(
      d.status as string,
      (d.state as Record<string, unknown>)?.status as string,
    ),
  );
  const error = str(
    d.error as string,
    (d.result as Record<string, unknown>)?.error as string,
  );
  const finalStatus = error && status === "success" ? "failure" : status;
  const callId =
    str(d.callId, d.id, d.toolCallId) ??
    (keyParts.length >= 2 ? keyParts.slice(1).join(":") : key);

  const activity: ActivityPayload = {
    sessionExternalId: composerId,
    externalId: callId,
    timestamp:
      toIso(num(d.timestamp, d.createdAt, d.time)) ?? new Date().toISOString(),
    actorType: "agent",
    actorId: "cursor",
    actionType: "tool_call",
    toolName,
    description: toolName ?? "Tool call",
    status: finalStatus,
    result:
      finalStatus === "failure"
        ? (error ?? (textSnippet(d.result ?? d.output, 2000) || undefined))
        : d.result !== undefined || d.output !== undefined
          ? textSnippet(d.result ?? d.output, 2000)
          : undefined,
    details: {
      kvKey: key,
      params: d.params ?? d.input ?? d.args,
      error,
    },
  };

  return {
    kind: "activity",
    // Status in the key lets a pending→completed transition land as a fresh
    // event (same trick as opencode's `part:<id>:<status>`).
    naturalKey: `cursor:tool:${callId}:${finalStatus}`,
    payload: activity,
  };
}

// ---------------------------------------------------------------------------
// cursor-agent store.db blobs → activities
// ---------------------------------------------------------------------------

/** Decode a blobs.data payload; null for protobuf/non-JSON blobs. */
export function decodeBlob(data: string | Uint8Array): unknown | null {
  const text =
    typeof data === "string" ? data : Buffer.from(data).toString("utf-8");
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

export function parseStoreBlob(
  sessionId: string,
  row: CursorBlobRow,
): IngestEvent | null {
  const value = decodeBlob(row.data);
  if (!value || typeof value !== "object") return null;
  const d = value as Record<string, unknown>;

  const role = str(d.role)?.toLowerCase();
  const ts = num(d.timestamp, d.createdAt, d.created_at, d.time);
  const model = str(
    d.model,
    (d.modelInfo as Record<string, unknown>)?.modelName as string,
  );

  if (role === "user") {
    const text = str(
      d.text,
      d.content as string,
      (d.message as Record<string, unknown>)?.text as string,
    );
    const activity: ActivityPayload = {
      sessionExternalId: sessionId,
      externalId: row.id,
      timestamp: toIso(ts) ?? new Date().toISOString(),
      actorType: "user",
      actorId: "user",
      actionType: "user_request",
      description: text?.slice(0, 500) || "User message",
      status: "success",
      model,
      details: { blobId: row.id },
    };
    return {
      kind: "activity",
      naturalKey: `cursor:store:${sessionId}:${row.id}`,
      payload: activity,
    };
  }

  if (role === "tool" || role === "tool_call" || role === "function") {
    const toolName = str(d.name, d.toolName, d.tool);
    const status = normalizeToolStatus(str(d.status as string));
    const error = str(d.error as string);
    const activity: ActivityPayload = {
      sessionExternalId: sessionId,
      externalId: row.id,
      timestamp: toIso(ts) ?? new Date().toISOString(),
      actorType: "agent",
      actorId: "cursor",
      actionType: "tool_call",
      toolName,
      description: toolName ?? "Tool call",
      status: error && status === "success" ? "failure" : status,
      result:
        error ??
        (d.result !== undefined || d.output !== undefined
          ? textSnippet(d.result ?? d.output, 2000)
          : undefined),
      details: { blobId: row.id, params: d.params ?? d.input ?? d.args },
    };
    return {
      kind: "activity",
      naturalKey: `cursor:store:${sessionId}:${row.id}`,
      payload: activity,
    };
  }

  if (role === "assistant" || role === "system") {
    const text = str(d.text, d.content as string);
    const activity: ActivityPayload = {
      sessionExternalId: sessionId,
      externalId: row.id,
      timestamp: toIso(ts) ?? new Date().toISOString(),
      actorType: "agent",
      actorId: "cursor",
      actionType: "message",
      description:
        text?.slice(0, 500) || `Assistant message${model ? ` (${model})` : ""}`,
      status: "success",
      model,
      details: { blobId: row.id, role },
    };
    return {
      kind: "activity",
      naturalKey: `cursor:store:${sessionId}:${row.id}`,
      payload: activity,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// meta.json → CLI session
// ---------------------------------------------------------------------------

export interface CursorChatMeta {
  title?: string;
  createdAtMs?: number;
  updatedAtMs?: number;
}

export function parseChatMetaJson(raw: string): CursorChatMeta | null {
  try {
    const d = JSON.parse(raw) as Record<string, unknown>;
    return {
      title: str(d.title, d.name),
      createdAtMs: num(d.createdAtMs, d.createdAt, d.created_at),
      updatedAtMs: num(d.updatedAtMs, d.updatedAt, d.lastUpdatedAt),
    };
  } catch {
    return null;
  }
}

export function chatMetaToIngestEvent(
  sessionId: string,
  meta: CursorChatMeta,
  counts: CursorSessionCounts,
  cwd?: string,
): IngestEvent {
  const updated = meta.updatedAtMs ?? meta.createdAtMs ?? 0;
  const payload: SessionPayload = {
    externalId: sessionId,
    cwd,
    title: meta.title || undefined,
    startedAt:
      toIso(meta.createdAtMs) ??
      toIso(meta.updatedAtMs) ??
      new Date().toISOString(),
    endedAt: toIso(meta.updatedAtMs),
    turnCount: counts.turnCount,
    toolCallCount: counts.toolCallCount,
    failureCount: counts.failureCount,
  };
  return {
    kind: "session",
    naturalKey: `cursor:cli:${sessionId}@${updated}:${counts.turnCount}:${counts.toolCallCount}:${counts.failureCount}`,
    payload,
  };
}
