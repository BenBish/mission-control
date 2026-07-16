/**
 * Grok session parser — ~/.grok/sessions/<encoded-cwd>/<session-id>/updates.jsonl
 *
 * Field shapes verified against local Grok CLI docs and real session files on
 * this machine. Grok stores one directory per session with summary.json,
 * signals.json, and updates.jsonl. The update stream is ACP-shaped:
 *
 *  - `session/update` records carry conversation and tool updates.
 *  - tool-call starts are represented as Pending updates with a `toolCallId`.
 *  - tool-call completions reuse the same `toolCallId` with completed/failed
 *    status.
 *  - `_x.ai/session/update` records carry per-turn usage totals (one event
 *    per completed user turn, including multi-step agent loops). Grok's
 *    `inputTokens` is **inclusive** of `cachedReadTokens` (verified:
 *    totalTokens ≈ inputTokens + outputTokens). We normalize to Claude-style
 *    non-cached input so Consumption `SUM(input_tokens)` is comparable
 *    across sources.
 *
 * The parser is deliberately permissive: it only relies on stable identifiers,
 * timestamps, status, titles, model ids, and usage counters. Transcript content
 * shape is less stable and is trimmed to short descriptions when present.
 */

import fs from "fs";
import path from "path";
import type {
  ActivityPayload,
  IngestEvent,
  SessionPayload,
} from "../../types/ingest.js";
import { calculateCost, getPricing } from "../../types/pricing.js";

export interface GrokSessionAggregate {
  externalId: string;
  cwd?: string;
  gitBranch?: string;
  title?: string;
  clientVersion?: string;
  model?: string;
  startedAt?: string;
  endedAt?: string;
  turnCount: number;
  toolCallCount: number;
  failureCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd?: number;
}

export function emptyAggregate(externalId: string): GrokSessionAggregate {
  return {
    externalId,
    turnCount: 0,
    toolCallCount: 0,
    failureCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
  };
}

export function aggregateToSessionPayload(
  agg: GrokSessionAggregate,
): SessionPayload {
  return {
    externalId: agg.externalId,
    cwd: agg.cwd,
    gitBranch: agg.gitBranch,
    title: agg.title,
    clientVersion: agg.clientVersion,
    modelProvider: "xai",
    startedAt: agg.startedAt ?? new Date().toISOString(),
    endedAt: agg.endedAt,
    turnCount: agg.turnCount,
    toolCallCount: agg.toolCallCount,
    failureCount: agg.failureCount,
    inputTokens: agg.inputTokens,
    outputTokens: agg.outputTokens,
    cacheReadTokens: agg.cacheReadTokens,
    costUsd: agg.costUsd,
  };
}

interface GrokSummary {
  current_model_id?: string;
  generated_title?: string;
  session_summary?: string;
  created_at?: string | number;
  updated_at?: string | number;
  git_root_dir?: string;
  head_branch?: string;
  agent_name?: string;
  info?: { version?: string };
}

interface GrokSignals {
  turnCount?: number;
  toolCallCount?: number;
  toolFailureCount?: number;
  inputTokens?: number;
  outputTokens?: number;
  contextTokensUsed?: number;
}

interface GrokUpdateRecord {
  method?: string;
  timestamp?: string | number;
  params?: {
    sessionId?: string;
    _meta?: {
      agentTimestampMs?: number;
      eventId?: string;
      updateParams?: {
        kind?: string;
        status?: string;
        title?: string;
        toolCallId?: string;
      };
    };
    update?: {
      kind?: string;
      status?: string;
      title?: string;
      toolCallId?: string;
      sessionUpdate?: unknown;
      rawInput?: unknown;
      rawOutput?: unknown;
      stop_reason?: string;
      usage?: GrokUsage;
      _meta?: {
        modelId?: string;
        promptIndex?: number;
        "x.ai/tool"?: {
          name?: string;
          label?: string;
          kind?: string;
          namespace?: string;
        };
      };
    };
  };
}

interface GrokUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedReadTokens?: number;
  reasoningTokens?: number;
  modelCalls?: number;
  apiDurationMs?: number;
  numTurns?: number;
  modelUsage?: Record<
    string,
    {
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
      cachedReadTokens?: number;
      reasoningTokens?: number;
      modelCalls?: number;
      apiDurationMs?: number;
    }
  >;
}

export interface ParsedLine {
  sessionExternalId: string;
  activity?: IngestEvent;
  sessionUpdate?: Partial<GrokSessionAggregate>;
  toolCallDelta?: number;
  failureDelta?: number;
}

export function sessionExternalIdFromPath(filePath: string): string | null {
  const dir = path.basename(path.dirname(filePath));
  return dir && dir !== "." ? dir : null;
}

export function cwdFromSessionPath(filePath: string): string | undefined {
  const encoded = path.basename(path.dirname(path.dirname(filePath)));
  if (!encoded || encoded === "." || encoded === "sessions") return undefined;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return undefined;
  }
}

function toIso(value: string | number | undefined): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return toIso(numeric);
    return value;
  }
  const millis = value > 10_000_000_000 ? value : value * 1000;
  return new Date(millis).toISOString();
}

function textSnippet(value: unknown): string {
  if (typeof value === "string") return value.slice(0, 500);
  if (Array.isArray(value)) {
    return value
      .map((item) => textSnippet(item))
      .filter(Boolean)
      .join(" ")
      .slice(0, 500);
  }
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  for (const key of ["text", "content", "message", "title"]) {
    const snippet = textSnippet(record[key]);
    if (snippet) return snippet;
  }
  return "";
}

function statusFor(raw: string | undefined): string {
  const status = raw?.toLowerCase();
  if (status === "completed" || status === "complete") return "success";
  if (status === "failed" || status === "error") return "failure";
  if (status === "cancelled" || status === "canceled") return "cancelled";
  if (status === "pending") return "running";
  return status ?? "success";
}

function costFor(
  model: string | undefined,
  inputTokens: number,
  outputTokens: number,
): number | undefined {
  if (!model) return undefined;
  const pricing = getPricing(model);
  if (
    pricing.inputCostPer1kTokens === 0 &&
    pricing.outputCostPer1kTokens === 0
  ) {
    return undefined;
  }
  return calculateCost(model, inputTokens, outputTokens);
}

/**
 * Normalize Grok usage counters to the same shape as Claude Code activities:
 * non-cached input in `inputTokens`, cache separately in `cacheReadTokens`.
 *
 * Grok CLI reports cache-inclusive input (`totalTokens ≈ input + output`).
 * Leaving that as-is makes Consumption SUMs look ~20× larger than other
 * sources when cache hit rates are high (~95% in sampled local sessions).
 */
export function normalizeGrokUsageTokens(usage: GrokUsage): {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
} {
  const rawInput = usage.inputTokens ?? 0;
  const cacheReadTokens = usage.cachedReadTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  // Keep total as the full billed/processed count (inclusive input + output)
  // so post-normalization rows satisfy total ≈ input + cache + output and
  // migration 001's old-shape predicate (input + output ≈ total) will not
  // match already-normalized rows.
  const totalTokens = usage.totalTokens ?? rawInput + outputTokens;
  return {
    inputTokens: Math.max(0, rawInput - cacheReadTokens),
    outputTokens,
    cacheReadTokens,
    totalTokens,
  };
}

function primaryUsageModel(usage: GrokUsage | undefined): string | undefined {
  const entries = Object.entries(usage?.modelUsage ?? {});
  if (entries.length === 0) return undefined;
  entries.sort((a, b) => (b[1].totalTokens ?? 0) - (a[1].totalTokens ?? 0));
  return entries[0]?.[0];
}

export function readGrokSessionSnapshot(
  updatesFilePath: string,
): Partial<GrokSessionAggregate> {
  const sessionDir = path.dirname(updatesFilePath);
  const summaryPath = path.join(sessionDir, "summary.json");
  const signalsPath = path.join(sessionDir, "signals.json");
  const snapshot: Partial<GrokSessionAggregate> = {
    cwd: cwdFromSessionPath(updatesFilePath),
  };

  try {
    const summary = JSON.parse(
      fs.readFileSync(summaryPath, "utf-8"),
    ) as GrokSummary;
    snapshot.cwd = summary.git_root_dir ?? snapshot.cwd;
    snapshot.gitBranch = summary.head_branch;
    snapshot.title = summary.generated_title ?? summary.session_summary;
    snapshot.model = summary.current_model_id;
    snapshot.clientVersion = summary.info?.version ?? summary.agent_name;
    snapshot.startedAt = toIso(summary.created_at);
    snapshot.endedAt = toIso(summary.updated_at);
  } catch {
    // Older/incomplete sessions can lack summary.json; updates.jsonl still works.
  }

  try {
    const signals = JSON.parse(
      fs.readFileSync(signalsPath, "utf-8"),
    ) as GrokSignals;
    snapshot.turnCount = signals.turnCount;
    snapshot.toolCallCount = signals.toolCallCount;
    snapshot.failureCount = signals.toolFailureCount;
    // Prefer explicit inputTokens only. `contextTokensUsed` is the current
    // window size, not total non-cached input — never treat it as input.
    snapshot.inputTokens = signals.inputTokens;
    snapshot.outputTokens = signals.outputTokens;
  } catch {
    // signals.json is a best-effort cumulative counter source.
  }

  if (
    snapshot.costUsd === undefined &&
    snapshot.model &&
    (snapshot.inputTokens || snapshot.outputTokens)
  ) {
    snapshot.costUsd = costFor(
      snapshot.model,
      snapshot.inputTokens ?? 0,
      snapshot.outputTokens ?? 0,
    );
  }

  return snapshot;
}

export function parseGrokLine(
  line: string,
  filePath: string,
): ParsedLine | null {
  const record = JSON.parse(line) as GrokUpdateRecord;
  const sessionExternalId =
    record.params?.sessionId ?? sessionExternalIdFromPath(filePath);
  if (!sessionExternalId) return null;

  const update = record.params?.update;
  const meta = record.params?._meta;
  const updateParams = meta?.updateParams;
  const timestamp =
    toIso(record.timestamp) ??
    toIso(meta?.agentTimestampMs) ??
    new Date().toISOString();
  const model = update?._meta?.modelId;

  if (record.method === "_x.ai/session/update") {
    const usage = update?.usage;
    if (!usage) return null;
    const usageModel = primaryUsageModel(usage) ?? model;
    const { inputTokens, outputTokens, cacheReadTokens, totalTokens } =
      normalizeGrokUsageTokens(usage);
    const costUsd = costFor(usageModel, inputTokens, outputTokens);
    const activity: ActivityPayload = {
      sessionExternalId,
      externalId: meta?.eventId,
      timestamp,
      actorType: "system",
      actorId: "grok-usage",
      actionType: "event",
      description: `Usage update${usageModel ? ` for ${usageModel}` : ""}`,
      status: statusFor(update?.stop_reason),
      inputTokens,
      outputTokens,
      cacheReadTokens,
      totalTokens,
      model: usageModel,
      costUsd,
      details: {
        reasoningTokens: usage.reasoningTokens,
        modelCalls: usage.modelCalls,
        apiDurationMs: usage.apiDurationMs,
        numTurns: usage.numTurns,
        // Preserve raw counters for debugging / reprocessing.
        rawInputTokens: usage.inputTokens,
        modelUsage: usage.modelUsage,
      },
    };

    return {
      sessionExternalId,
      sessionUpdate: {
        model: usageModel,
        endedAt: timestamp,
        // Do not set turnCount from usage.numTurns — that is the per-turn
        // model-loop count, not session-level user turns (signals.turnCount).
        inputTokens,
        outputTokens,
        cacheReadTokens,
        costUsd,
      },
      activity: {
        kind: "activity",
        naturalKey: `${filePath}:${meta?.eventId ?? timestamp}:usage`,
        payload: activity,
      },
    };
  }

  const toolCallId = update?.toolCallId ?? updateParams?.toolCallId;
  const tool = update?._meta?.["x.ai/tool"];
  const title = update?.title ?? updateParams?.title;
  const kind = update?.kind ?? updateParams?.kind;
  const rawStatus = update?.status ?? updateParams?.status;

  if (toolCallId || tool?.name || rawStatus) {
    const status = statusFor(rawStatus);
    const toolName = tool?.name ?? title;
    const activity: ActivityPayload = {
      sessionExternalId,
      externalId: toolCallId ?? meta?.eventId,
      timestamp,
      actorType: "agent",
      actorId: "grok",
      actionType: "tool_call",
      toolName,
      description:
        title ??
        tool?.label ??
        toolName ??
        kind ??
        (status === "running" ? "Tool call started" : "Tool call"),
      status,
      model,
      details: {
        kind,
        toolCallId,
        namespace: tool?.namespace,
        rawInput: update?.rawInput,
        rawOutput: update?.rawOutput,
      },
    };

    return {
      sessionExternalId,
      sessionUpdate: {
        model,
        endedAt: timestamp,
      },
      toolCallDelta: status === "running" ? 1 : 0,
      failureDelta: status === "failure" ? 1 : 0,
      activity: {
        kind: "activity",
        naturalKey: `${filePath}:${toolCallId ?? meta?.eventId ?? timestamp}:${status}`,
        payload: activity,
      },
    };
  }

  const sessionUpdateText = textSnippet(update?.sessionUpdate);
  if (sessionUpdateText || model) {
    const actorType =
      update?._meta?.promptIndex !== undefined ? "user" : "agent";
    const activity: ActivityPayload = {
      sessionExternalId,
      externalId: meta?.eventId,
      timestamp,
      actorType,
      actorId: actorType === "user" ? "user" : "grok",
      actionType: actorType === "user" ? "user_request" : "message",
      description: sessionUpdateText || "Session update",
      status: "success",
      model,
    };

    return {
      sessionExternalId,
      sessionUpdate: {
        model,
        startedAt: timestamp,
        endedAt: timestamp,
        turnCount: actorType === "user" ? 1 : undefined,
      },
      activity: {
        kind: "activity",
        naturalKey: `${filePath}:${meta?.eventId ?? timestamp}:message`,
        payload: activity,
      },
    };
  }

  return null;
}

export function mergeSessionUpdate(
  agg: GrokSessionAggregate,
  update: Partial<GrokSessionAggregate>,
): GrokSessionAggregate {
  return {
    ...agg,
    cwd: update.cwd ?? agg.cwd,
    gitBranch: update.gitBranch ?? agg.gitBranch,
    title: update.title ?? agg.title,
    clientVersion: update.clientVersion ?? agg.clientVersion,
    model: update.model ?? agg.model,
    startedAt:
      !agg.startedAt || (update.startedAt && update.startedAt < agg.startedAt)
        ? (update.startedAt ?? agg.startedAt)
        : agg.startedAt,
    endedAt:
      !agg.endedAt || (update.endedAt && update.endedAt > agg.endedAt)
        ? (update.endedAt ?? agg.endedAt)
        : agg.endedAt,
    turnCount: update.turnCount ?? agg.turnCount,
    toolCallCount: Math.max(agg.toolCallCount, update.toolCallCount ?? 0),
    failureCount: Math.max(agg.failureCount, update.failureCount ?? 0),
    inputTokens: update.inputTokens ?? agg.inputTokens,
    outputTokens: update.outputTokens ?? agg.outputTokens,
    cacheReadTokens: update.cacheReadTokens ?? agg.cacheReadTokens,
    costUsd: update.costUsd ?? agg.costUsd,
  };
}
