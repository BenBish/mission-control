/**
 * Per-request inference telemetry, derived from llama-server's own
 * completion logging in the systemd --user journal for each
 * llama-toolbox-*.service unit (see src/collectors/hermes/config.ts for
 * the port/unit topology).
 *
 * Neither llama-swap's /logs (a plain HTTP access log of requests to the
 * router itself, no per-completion token/timing data) nor llama-server's
 * own /metrics (cumulative counters since process start, no per-request
 * breakdown) carry what's needed here — this journal is the only source
 * with real per-request token/timing/failure data. Verified against real
 * log lines on the box this targets; see the regexes below for exact
 * formats.
 *
 * A completed request is reconstructed from several log lines for the
 * same (slot id, task id) pair, which can interleave with lines for a
 * *different* task on a *different* slot of the same unit (concurrent
 * slots). Tasks are buffered by "slot:task" key until a closing line
 * (release, or send_error+cancel) arrives; tasks still open when a tick
 * ends just stay buffered for the next tick. A task that never closes
 * (still in-flight, or its close line was missed across a restart before
 * the cursor advanced past its launch) is simply dropped when the buffer
 * is discarded on restart — there's no way to recover it, and an
 * incomplete row would be worse than no row.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import type { IngestEvent } from "../../types/ingest.js";
import type { HermesBackend } from "./config.js";

const execFileAsync = promisify(execFile);

export interface JournalEntry {
  __CURSOR: string;
  __REALTIME_TIMESTAMP: string;
  MESSAGE: string;
}

async function readJournal(
  unit: string,
  afterCursor: string | undefined,
): Promise<JournalEntry[]> {
  const args = [
    "--user",
    "-u",
    unit,
    "-o",
    "json",
    "--no-pager",
    "--output-fields=__CURSOR,__REALTIME_TIMESTAMP,MESSAGE",
  ];
  if (afterCursor) {
    args.push(`--after-cursor=${afterCursor}`);
  } else {
    // First run for this unit: don't replay potentially days of history —
    // start from the current tail.
    args.push("-n", "0");
  }

  const { stdout } = await execFileAsync("journalctl", args, {
    maxBuffer: 32 * 1024 * 1024,
  });
  if (!stdout.trim()) return [];

  const entries: JournalEntry[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as JournalEntry);
    } catch {
      // Malformed line — skip, don't fail the whole tick over one entry.
    }
  }
  return entries;
}

/** Seed a cursor at the current tail (used on first run for a unit, so we
 *  don't replay history — see readJournal's "-n 0" branch, which already
 *  returns zero entries; this just gets us a real cursor value to persist
 *  going forward instead of leaving it undefined forever). */
async function tailCursor(unit: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("journalctl", [
      "--user",
      "-u",
      unit,
      "-n",
      "1",
      "-o",
      "json",
      "--no-pager",
      "--output-fields=__CURSOR",
    ]);
    if (!stdout.trim()) return undefined;
    const entry = JSON.parse(stdout.trim().split("\n").pop()!) as {
      __CURSOR?: string;
    };
    return entry.__CURSOR;
  } catch {
    return undefined;
  }
}

// ─── Line parsing ───────────────────────────────────────────────────────────

interface LaunchLine {
  type: "launch";
  slot: number;
  task: number;
}
interface PromptEvalLine {
  type: "prompt_eval";
  slot: number;
  task: number;
  ms: number;
  tokens: number;
}
interface EvalLine {
  type: "eval";
  slot: number;
  task: number;
  ms: number;
  tokens: number;
  tokensPerSec: number;
}
interface TotalLine {
  type: "total";
  slot: number;
  task: number;
  ms: number;
  tokens: number;
}
interface ReleaseLine {
  type: "release";
  slot: number;
  task: number;
  nTokens: number;
  truncated: boolean;
}
interface SendErrorLine {
  type: "send_error";
  task: number;
  error: string;
}
interface CancelLine {
  type: "cancel";
  task: number;
}
type ParsedLine =
  | LaunchLine
  | PromptEvalLine
  | EvalLine
  | TotalLine
  | ReleaseLine
  | SendErrorLine
  | CancelLine;

const RE_LAUNCH =
  /slot\s+launch_slot_:\s*id\s+(\d+)\s*\|\s*task\s+(\d+)\s*\|\s*processing task/;
const RE_PROMPT_EVAL =
  /slot\s+print_timing:\s*id\s+(\d+)\s*\|\s*task\s+(\d+)\s*\|\s*prompt eval time\s*=\s*([\d.]+)\s*ms\s*\/\s*(\d+)\s*tokens/;
const RE_EVAL =
  /slot\s+print_timing:\s*id\s+(\d+)\s*\|\s*task\s+(\d+)\s*\|\s*eval time\s*=\s*([\d.]+)\s*ms\s*\/\s*(\d+)\s*tokens\s*\(\s*([\d.]+)\s*ms per token,\s*([\d.]+)\s*tokens per second\)/;
const RE_TOTAL =
  /slot\s+print_timing:\s*id\s+(\d+)\s*\|\s*task\s+(\d+)\s*\|\s*total time\s*=\s*([\d.]+)\s*ms\s*\/\s*(\d+)\s*tokens/;
const RE_RELEASE =
  /slot\s+release:\s*id\s+(\d+)\s*\|\s*task\s+(\d+)\s*\|\s*stop processing:\s*n_tokens\s*=\s*(\d+),\s*truncated\s*=\s*(\d+)/;
const RE_SEND_ERROR =
  /srv\s+send_error:\s*task id\s*=\s*(\d+),\s*error:\s*(.+)$/;
const RE_CANCEL = /srv\s+stop:\s*cancel task,\s*id_task\s*=\s*(\d+)/;

/** Order matters here: RE_PROMPT_EVAL must be tried before RE_EVAL. Real
 *  "prompt eval time" lines also carry the "(... ms per token, ... tokens
 *  per second)" suffix (see the test fixtures), so RE_EVAL's pattern
 *  matches them too — as a substring starting right after "prompt ", since
 *  neither regex is start-anchored. Trying RE_PROMPT_EVAL first means it
 *  claims those lines via its earlier, unconditional return; if the order
 *  were ever swapped, "prompt eval time" lines would be misparsed as
 *  "eval time" lines instead. */
export function parseLine(message: string): ParsedLine | null {
  let m = message.match(RE_LAUNCH);
  if (m) return { type: "launch", slot: Number(m[1]), task: Number(m[2]) };

  m = message.match(RE_PROMPT_EVAL);
  if (m)
    return {
      type: "prompt_eval",
      slot: Number(m[1]),
      task: Number(m[2]),
      ms: Number(m[3]),
      tokens: Number(m[4]),
    };

  m = message.match(RE_EVAL);
  if (m)
    return {
      type: "eval",
      slot: Number(m[1]),
      task: Number(m[2]),
      ms: Number(m[3]),
      tokens: Number(m[4]),
      tokensPerSec: Number(m[6]),
    };

  m = message.match(RE_TOTAL);
  if (m)
    return {
      type: "total",
      slot: Number(m[1]),
      task: Number(m[2]),
      ms: Number(m[3]),
      tokens: Number(m[4]),
    };

  m = message.match(RE_RELEASE);
  if (m)
    return {
      type: "release",
      slot: Number(m[1]),
      task: Number(m[2]),
      nTokens: Number(m[3]),
      truncated: m[4] === "1",
    };

  m = message.match(RE_SEND_ERROR);
  if (m) return { type: "send_error", task: Number(m[1]), error: m[2] };

  m = message.match(RE_CANCEL);
  if (m) return { type: "cancel", task: Number(m[1]) };

  return null;
}

// ─── Task buffering + event emission ───────────────────────────────────────

interface OpenTask {
  slot: number;
  task: number;
  launchedAtIso: string;
  promptMs?: number;
  promptTokens?: number;
  evalMs?: number;
  evalTokens?: number;
  tokensPerSec?: number;
  totalMs?: number;
  sendError?: string;
}

/** Persisted state for one unit's log parser — survives a server restart
 *  via CollectorStateStore. Open-task buffers are intentionally NOT
 *  persisted (see file header); only the journal cursor is. */
export interface LogParserState {
  cursor?: string;
}

export class HermesLogParser {
  private open = new Map<string, OpenTask>();

  constructor(private backend: HermesBackend) {}

  private key(slot: number, task: number): string {
    return `${slot}:${task}`;
  }

  /**
   * Read new journal lines since the persisted cursor and emit one
   * IngestEvent per request that closed (successfully or not) during
   * this tick. Returns the new cursor to persist — only persist it after
   * the returned events have been successfully sent (same at-least-once
   * discipline as the JSONL collectors).
   */
  async tick(
    state: LogParserState,
  ): Promise<{ events: IngestEvent[]; cursor: string | undefined }> {
    let cursor = state.cursor;
    if (!cursor) {
      cursor = await tailCursor(this.backend.unit);
      return { events: [], cursor };
    }

    const entries = await readJournal(this.backend.unit, cursor);
    if (entries.length === 0) {
      return { events: [], cursor };
    }

    return this.processEntries(entries);
  }

  /**
   * The actual buffering/correlation logic, split out from tick() so it's
   * testable against hand-built journal entries without shelling out to
   * journalctl — this is the part with real correctness risk (multi-line
   * task lifecycle correlation across interleaved slots), the journalctl
   * plumbing around it is a thin, low-risk wrapper.
   */
  processEntries(entries: JournalEntry[]): {
    events: IngestEvent[];
    cursor: string;
  } {
    let cursor = entries[entries.length - 1].__CURSOR;
    const events: IngestEvent[] = [];

    for (const entry of entries) {
      cursor = entry.__CURSOR;
      const parsed = parseLine(entry.MESSAGE);
      if (!parsed) continue;
      const timestampIso = new Date(
        Number(entry.__REALTIME_TIMESTAMP) / 1000,
      ).toISOString();

      if (parsed.type === "launch") {
        this.open.set(this.key(parsed.slot, parsed.task), {
          slot: parsed.slot,
          task: parsed.task,
          launchedAtIso: timestampIso,
        });
        continue;
      }

      if (parsed.type === "send_error") {
        // send_error only carries a task id, not a slot id — search by task.
        const found = [...this.open.entries()].find(
          ([, t]) => t.task === parsed.task,
        );
        const openTask = found?.[1] ?? {
          slot: -1,
          task: parsed.task,
          launchedAtIso: timestampIso,
        };
        openTask.sendError = parsed.error;
        this.open.set(this.key(openTask.slot, parsed.task), openTask);
        continue;
      }

      if (parsed.type === "cancel") {
        const found = [...this.open.entries()].find(
          ([, t]) => t.task === parsed.task,
        );
        if (!found) continue; // no matching launch seen (e.g. across a restart) — drop
        const [key, openTask] = found;
        events.push(
          this.buildEvent(
            openTask,
            openTask.sendError
              ? { status: "context_overflow", error: openTask.sendError }
              : { status: "cancelled" },
          ),
        );
        this.open.delete(key);
        continue;
      }

      // prompt_eval / eval / total / release all carry slot+task directly.
      const key = this.key(parsed.slot, parsed.task);
      const openTask = this.open.get(key);
      if (!openTask) continue; // no matching launch seen — drop

      if (parsed.type === "prompt_eval") {
        openTask.promptMs = parsed.ms;
        openTask.promptTokens = parsed.tokens;
      } else if (parsed.type === "eval") {
        openTask.evalMs = parsed.ms;
        openTask.evalTokens = parsed.tokens;
        openTask.tokensPerSec = parsed.tokensPerSec;
      } else if (parsed.type === "total") {
        openTask.totalMs = parsed.ms;
      } else if (parsed.type === "release") {
        // A send_error may have been recorded for this task before it was
        // released (e.g. a context-overflow error that the server still
        // released the slot for, rather than the task being explicitly
        // cancelled) — don't report it as a plain success in that case.
        events.push(
          this.buildEvent(
            openTask,
            openTask.sendError
              ? { status: "context_overflow", error: openTask.sendError }
              : { status: "success" },
          ),
        );
        this.open.delete(key);
      }
    }

    return { events, cursor };
  }

  private buildEvent(
    task: OpenTask,
    outcome:
      | { status: "success" }
      | { status: "cancelled" }
      | { status: "context_overflow"; error: string },
  ): IngestEvent {
    const naturalKey = `${this.backend.unit}:${task.task}`;
    if (outcome.status !== "success") {
      return {
        kind: "inference_request",
        naturalKey,
        payload: {
          externalId: String(task.task),
          timestamp: task.launchedAtIso,
          endpoint: `http://127.0.0.1:${this.backend.port}`,
          clientLabel: this.backend.label,
          workload: "unknown",
          slotId: task.slot >= 0 ? task.slot : undefined,
          status: outcome.status,
          error:
            outcome.status === "context_overflow" ? outcome.error : undefined,
        },
      };
    }

    return {
      kind: "inference_request",
      naturalKey,
      payload: {
        externalId: String(task.task),
        timestamp: task.launchedAtIso,
        endpoint: `http://127.0.0.1:${this.backend.port}`,
        clientLabel: this.backend.label,
        workload: "unknown",
        promptTokens: task.promptTokens,
        completionTokens: task.evalTokens,
        // Approximation, not a true first-token timestamp: prompt eval
        // completes immediately before generation (and thus the first
        // token) begins, so its duration is a reasonable TTFT proxy.
        ttftMs: task.promptMs != null ? Math.round(task.promptMs) : undefined,
        durationMs: task.totalMs != null ? Math.round(task.totalMs) : undefined,
        tokensPerSec: task.tokensPerSec,
        slotId: task.slot,
        status: "success",
      },
    };
  }
}

/** For inference_requests that closed as cancelled/context_overflow, also
 *  emit the matching runtime_event the schema/plan calls for ("each
 *  failure also emits a runtime_event"). Call alongside buildEvent's
 *  output — kept separate since it targets a different ingest kind. */
export function failureRuntimeEvent(
  backend: HermesBackend,
  event: IngestEvent,
): IngestEvent | null {
  if (event.kind !== "inference_request") return null;
  const payload = event.payload as {
    status?: string;
    timestamp: string;
    error?: string;
  };
  if (payload.status === "context_overflow") {
    return {
      kind: "runtime_event",
      naturalKey: `${event.naturalKey}:context_overflow`,
      payload: {
        timestamp: payload.timestamp,
        kind: "context_overflow",
        severity: "warning",
        summary: `Context overflow on ${backend.label} (port ${backend.port})`,
        details: { error: payload.error },
      },
    };
  }
  if (payload.status === "cancelled") {
    return {
      kind: "runtime_event",
      naturalKey: `${event.naturalKey}:cancelled`,
      payload: {
        timestamp: payload.timestamp,
        kind: "request_cancelled",
        severity: "info",
        summary: `Request cancelled on ${backend.label} (port ${backend.port})`,
      },
    };
  }
  return null;
}
