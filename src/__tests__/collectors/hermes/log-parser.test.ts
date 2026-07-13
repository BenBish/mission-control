/**
 * Log-parsing/correlation tests against real captured journal lines from
 * llama-toolbox-qwen-hermes.service on the live Strix Halo box (2026-07-13)
 * — not synthetic examples. See src/collectors/hermes/log-parser.ts's file
 * header for the full request-lifecycle line sequence this is built from.
 */

import { describe, test, expect } from "bun:test";
import {
  parseLine,
  HermesLogParser,
  failureRuntimeEvent,
  type JournalEntry,
} from "../../../collectors/hermes/log-parser.js";
import type { HermesBackend } from "../../../collectors/hermes/config.js";
import type {
  InferenceRequestPayload,
  RuntimeEventPayload,
} from "../../../types/ingest.js";

const BACKEND: HermesBackend = {
  port: 12346,
  unit: "llama-toolbox-qwen-hermes.service",
  label: "hermes-qwen",
  sharedByGateways: true,
};

describe("parseLine", () => {
  test("parses a launch_slot_ line", () => {
    const line = parseLine(
      "2132.05.811.276 I slot launch_slot_: id  1 | task 19358 | processing task, is_child = 0",
    );
    expect(line).toEqual({ type: "launch", slot: 1, task: 19358 });
  });

  test("parses a prompt eval time line, not confused with plain eval time", () => {
    const line = parseLine(
      "2133.07.199.056 I slot print_timing: id  1 | task 19358 | prompt eval time =    1977.36 ms /   384 tokens (    5.15 ms per token,   194.20 tokens per second)",
    );
    expect(line).toEqual({
      type: "prompt_eval",
      slot: 1,
      task: 19358,
      ms: 1977.36,
      tokens: 384,
    });
  });

  test("parses a plain eval time line, not matched by the prompt-eval regex", () => {
    const line = parseLine(
      "2133.07.199.061 I slot print_timing: id  1 | task 19358 |        eval time =   59410.21 ms /   601 tokens (   98.85 ms per token,    10.12 tokens per second)",
    );
    expect(line).toEqual({
      type: "eval",
      slot: 1,
      task: 19358,
      ms: 59410.21,
      tokens: 601,
      tokensPerSec: 10.12,
    });
  });

  test("parses a total time line", () => {
    const line = parseLine(
      "2133.07.199.062 I slot print_timing: id  1 | task 19358 |       total time =   61387.57 ms /   985 tokens",
    );
    expect(line).toEqual({
      type: "total",
      slot: 1,
      task: 19358,
      ms: 61387.57,
      tokens: 985,
    });
  });

  test("parses a release line with truncated=0", () => {
    const line = parseLine(
      "2133.07.199.946 I slot      release: id  1 | task 19358 | stop processing: n_tokens = 13046, truncated = 0",
    );
    expect(line).toEqual({
      type: "release",
      slot: 1,
      task: 19358,
      nTokens: 13046,
      truncated: false,
    });
  });

  test("parses a release line with truncated=1", () => {
    const line = parseLine(
      "0.00.000.000 I slot      release: id  0 | task 42 | stop processing: n_tokens = 8192, truncated = 1",
    );
    expect(line?.type === "release" && line.truncated).toBe(true);
  });

  test("parses a context-overflow send_error line", () => {
    const line = parseLine(
      "124.52.877.695 E srv    send_error: task id = 12841, error: request (69225 tokens) exceeds the available context size (65536 tokens), try increasing it",
    );
    expect(line).toEqual({
      type: "send_error",
      task: 12841,
      error:
        "request (69225 tokens) exceeds the available context size (65536 tokens), try increasing it",
    });
  });

  test("parses a bare cancel line", () => {
    const line = parseLine(
      "127.51.334.075 W srv          stop: cancel task, id_task = 13557",
    );
    expect(line).toEqual({ type: "cancel", task: 13557 });
  });

  test("returns null for an unrecognized line", () => {
    expect(parseLine("some unrelated podman log noise")).toBeNull();
    expect(
      parseLine(
        "2132.05.634.864 I slot print_timing: id  1 | task 19240 |    graphs reused =      18788",
      ),
    ).toBeNull();
  });
});

function entry(
  cursor: string,
  realtimeUs: number,
  message: string,
): JournalEntry {
  return {
    __CURSOR: cursor,
    __REALTIME_TIMESTAMP: String(realtimeUs),
    MESSAGE: message,
  };
}

describe("HermesLogParser.processEntries — real request lifecycles", () => {
  test("a full success sequence emits one inference_request with correct fields", () => {
    const parser = new HermesLogParser(BACKEND);
    const entries: JournalEntry[] = [
      entry(
        "c1",
        1_000_000,
        "t I slot launch_slot_: id  1 | task 19358 | processing task, is_child = 0",
      ),
      entry(
        "c2",
        1_002_000,
        "t I slot print_timing: id  1 | task 19358 | prompt eval time =    1977.36 ms /   384 tokens (5.15 ms per token, 194.20 tokens per second)",
      ),
      entry(
        "c3",
        1_003_000,
        "t I slot print_timing: id  1 | task 19358 |        eval time =   59410.21 ms /   601 tokens (98.85 ms per token, 10.12 tokens per second)",
      ),
      entry(
        "c4",
        1_004_000,
        "t I slot print_timing: id  1 | task 19358 |       total time =   61387.57 ms /   985 tokens",
      ),
      entry(
        "c5",
        1_005_000,
        "t I slot      release: id  1 | task 19358 | stop processing: n_tokens = 13046, truncated = 0",
      ),
    ];

    const { events, cursor } = parser.processEntries(entries);

    expect(cursor).toBe("c5");
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("inference_request");
    const payload = events[0].payload as InferenceRequestPayload;
    expect(payload.status).toBe("success");
    expect(payload.promptTokens).toBe(384);
    expect(payload.completionTokens).toBe(601);
    expect(payload.durationMs).toBe(61388); // rounded
    expect(payload.ttftMs).toBe(1977); // rounded
    expect(payload.tokensPerSec).toBe(10.12);
    expect(payload.slotId).toBe(1);
    expect(payload.timestamp).toBe(new Date(1_000_000 / 1000).toISOString()); // launch time, not release time
    expect(events[0].naturalKey).toBe(`${BACKEND.unit}:19358`);
  });

  test("interleaved slots don't cross-contaminate each other's fields", () => {
    const parser = new HermesLogParser(BACKEND);
    const entries: JournalEntry[] = [
      entry(
        "c1",
        1_000_000,
        "t I slot launch_slot_: id  0 | task 100 | processing task, is_child = 0",
      ),
      entry(
        "c2",
        1_001_000,
        "t I slot launch_slot_: id  1 | task 200 | processing task, is_child = 0",
      ),
      // slot 0's completion lines interleaved with slot 1's
      entry(
        "c3",
        1_002_000,
        "t I slot print_timing: id  0 | task 100 | prompt eval time = 100.0 ms / 10 tokens (10 ms per token, 100 tokens per second)",
      ),
      entry(
        "c4",
        1_003_000,
        "t I slot print_timing: id  1 | task 200 | prompt eval time = 200.0 ms / 20 tokens (10 ms per token, 100 tokens per second)",
      ),
      entry(
        "c5",
        1_004_000,
        "t I slot print_timing: id  0 | task 100 |        eval time = 300.0 ms / 30 tokens (10 ms per token, 100 tokens per second)",
      ),
      entry(
        "c6",
        1_005_000,
        "t I slot print_timing: id  1 | task 200 |        eval time = 400.0 ms / 40 tokens (10 ms per token, 100 tokens per second)",
      ),
      entry(
        "c7",
        1_006_000,
        "t I slot print_timing: id  0 | task 100 |       total time = 500.0 ms / 40 tokens",
      ),
      entry(
        "c8",
        1_007_000,
        "t I slot      release: id  0 | task 100 | stop processing: n_tokens = 40, truncated = 0",
      ),
      entry(
        "c9",
        1_008_000,
        "t I slot print_timing: id  1 | task 200 |       total time = 700.0 ms / 60 tokens",
      ),
      entry(
        "c10",
        1_009_000,
        "t I slot      release: id  1 | task 200 | stop processing: n_tokens = 60, truncated = 0",
      ),
    ];

    const { events } = parser.processEntries(entries);

    expect(events).toHaveLength(2);
    const task100 = events.find((e) => e.naturalKey.endsWith(":100"));
    const task200 = events.find((e) => e.naturalKey.endsWith(":200"));
    expect((task100?.payload as InferenceRequestPayload).promptTokens).toBe(10);
    expect((task100?.payload as InferenceRequestPayload).completionTokens).toBe(
      30,
    );
    expect((task100?.payload as InferenceRequestPayload).slotId).toBe(0);
    expect((task200?.payload as InferenceRequestPayload).promptTokens).toBe(20);
    expect((task200?.payload as InferenceRequestPayload).completionTokens).toBe(
      40,
    );
    expect((task200?.payload as InferenceRequestPayload).slotId).toBe(1);
  });

  test("context_overflow: send_error followed by cancel emits one failed request with the error message, no completion tokens", () => {
    const parser = new HermesLogParser(BACKEND);
    const entries: JournalEntry[] = [
      entry(
        "c1",
        1_000_000,
        "t I slot launch_slot_: id  0 | task 12841 | processing task, is_child = 0",
      ),
      entry(
        "c2",
        1_001_000,
        "t E srv    send_error: task id = 12841, error: request (69225 tokens) exceeds the available context size (65536 tokens), try increasing it",
      ),
      entry(
        "c3",
        1_002_000,
        "t W srv          stop: cancel task, id_task = 12841",
      ),
    ];

    const { events } = parser.processEntries(entries);

    // processEntries() itself only emits the inference_request — the
    // matching runtime_event (failureRuntimeEvent) is composed one level
    // up, in HermesBackendCollector, tested separately below.
    expect(events).toHaveLength(1);
    const inferenceEvent = events.find((e) => e.kind === "inference_request")!;
    const payload = inferenceEvent.payload as InferenceRequestPayload;
    expect(payload.status).toBe("context_overflow");
    expect(payload.error).toContain("exceeds the available context size");
    expect(payload.completionTokens).toBeUndefined();
  });

  test("a bare cancel with no preceding send_error emits status:'cancelled'", () => {
    const parser = new HermesLogParser(BACKEND);
    const entries: JournalEntry[] = [
      entry(
        "c1",
        1_000_000,
        "t I slot launch_slot_: id  0 | task 13557 | processing task, is_child = 0",
      ),
      entry(
        "c2",
        1_001_000,
        "t W srv          stop: cancel task, id_task = 13557",
      ),
    ];

    const { events } = parser.processEntries(entries);
    const inferenceEvent = events.find((e) => e.kind === "inference_request")!;
    expect((inferenceEvent.payload as InferenceRequestPayload).status).toBe(
      "cancelled",
    );
  });

  test("a release for a task with no matching launch (e.g. across a restart) is silently dropped, not crashed on", () => {
    const parser = new HermesLogParser(BACKEND);
    const entries: JournalEntry[] = [
      entry(
        "c1",
        1_000_000,
        "t I slot      release: id  0 | task 99999 | stop processing: n_tokens = 10, truncated = 0",
      ),
    ];

    const { events, cursor } = parser.processEntries(entries);
    expect(events).toEqual([]);
    expect(cursor).toBe("c1");
  });

  test("an in-flight task with no closing line yet stays buffered and emits nothing", () => {
    const parser = new HermesLogParser(BACKEND);
    const entries: JournalEntry[] = [
      entry(
        "c1",
        1_000_000,
        "t I slot launch_slot_: id  0 | task 1 | processing task, is_child = 0",
      ),
      entry(
        "c2",
        1_001_000,
        "t I slot print_timing: id  0 | task 1 | n_decoded = 100, tg = 10.0 t/s, tg_3s = 10.0 t/s",
      ),
    ];

    const { events } = parser.processEntries(entries);
    expect(events).toEqual([]);
  });
});

describe("failureRuntimeEvent", () => {
  test("maps a context_overflow inference_request to a context_overflow runtime_event", () => {
    const event = failureRuntimeEvent(BACKEND, {
      kind: "inference_request",
      naturalKey: "x:1",
      payload: {
        timestamp: "2026-01-01T00:00:00.000Z",
        status: "context_overflow",
        error: "request exceeds context size",
      } as InferenceRequestPayload,
    });
    expect(event?.kind).toBe("runtime_event");
    const payload = event?.payload as RuntimeEventPayload;
    expect(payload.kind).toBe("context_overflow");
    expect(payload.severity).toBe("warning");
  });

  test("maps a cancelled inference_request to a request_cancelled runtime_event", () => {
    const event = failureRuntimeEvent(BACKEND, {
      kind: "inference_request",
      naturalKey: "x:2",
      payload: {
        timestamp: "2026-01-01T00:00:00.000Z",
        status: "cancelled",
      } as InferenceRequestPayload,
    });
    expect((event?.payload as RuntimeEventPayload).kind).toBe(
      "request_cancelled",
    );
  });

  test("returns null for a successful request — no failure event to emit", () => {
    const event = failureRuntimeEvent(BACKEND, {
      kind: "inference_request",
      naturalKey: "x:3",
      payload: {
        timestamp: "2026-01-01T00:00:00.000Z",
        status: "success",
      } as InferenceRequestPayload,
    });
    expect(event).toBeNull();
  });

  test("returns null for a non-inference_request event kind", () => {
    const event = failureRuntimeEvent(BACKEND, {
      kind: "runtime_snapshot",
      naturalKey: "x:4",
      payload: { timestamp: "2026-01-01T00:00:00.000Z", kind: "slots" },
    });
    expect(event).toBeNull();
  });
});
