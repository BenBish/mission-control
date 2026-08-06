import { describe, expect, test } from "bun:test";
import {
  classifyFailureSignal,
  computeFailureFingerprint,
  isFailureEventResolved,
  normalizeFailureMessage,
} from "../../lib/failure-fingerprint.js";

describe("normalizeFailureMessage", () => {
  test("lowercases and collapses whitespace", () => {
    expect(normalizeFailureMessage("  Slot  Saturated  ")).toBe(
      "slot saturated",
    );
  });

  test("replaces UUIDs, ISO timestamps, and long numbers", () => {
    const raw =
      "cancel request 550e8400-e29b-41d4-a716-446655440000 at 2026-07-21T01:08:48.080Z after 12345 ms";
    expect(normalizeFailureMessage(raw)).toBe(
      "cancel request <id> at <ts> after <n> ms",
    );
  });

  test("collapses Claude tool_use / tool_result ids", () => {
    expect(
      normalizeFailureMessage("Tool result for toolu_01AbCdEfGhIjKlMnOpQrStUv"),
    ).toBe("tool result for <tool_id>");
  });

  test("collapses call_ / fc_ ids used by Grok / OpenAI tool calls", () => {
    expect(
      normalizeFailureMessage("tool failed call_abc123xyz999 status error"),
    ).toBe("tool failed <call_id> status error");
    expect(normalizeFailureMessage("fc_9Z8Y7X6W5V4U3T2S failed")).toBe(
      "<call_id> failed",
    );
  });
});

describe("computeFailureFingerprint", () => {
  test("runtime events with identical summary share a fingerprint; differing free-text does not", () => {
    const a = computeFailureFingerprint({
      kind: "runtime_event",
      sourceId: "hermes",
      summary: "slots saturated on worker-1",
      eventKind: "slots_saturated",
      severity: "warning",
    });
    const b = computeFailureFingerprint({
      kind: "runtime_event",
      sourceId: "hermes",
      summary: "slots saturated on worker-2",
      detail: '{"slot":12}',
      eventKind: "slots_saturated",
      severity: "warning",
    });
    // Same source + eventKind + severity; message normalizes differently if
    // worker numbers differ — but both still group by structured fields first.
    // worker-1 vs worker-2 produce different message parts after normalize
    // (single digits stay). Ensure pure structural siblings with same summary group.
    const c = computeFailureFingerprint({
      kind: "runtime_event",
      sourceId: "hermes",
      summary: "slots saturated on worker-1",
      eventKind: "slots_saturated",
      severity: "warning",
    });
    expect(a).toBe(c);
    expect(a.startsWith("runtime_event|hermes|slots_saturated|warning|")).toBe(
      true,
    );
    // Different summary text yields different fingerprint (message is part of key)
    expect(a).not.toBe(b);
  });

  test("cancellation events group by eventKind across id-heavy messages", () => {
    const a = computeFailureFingerprint({
      kind: "runtime_event",
      sourceId: "hermes",
      summary:
        "request_cancelled for 550e8400-e29b-41d4-a716-446655440000 at 2026-07-21T01:08:48.080Z",
      eventKind: "request_cancelled",
      severity: "warning",
    });
    const b = computeFailureFingerprint({
      kind: "runtime_event",
      sourceId: "hermes",
      summary:
        "request_cancelled for 660e8400-e29b-41d4-a716-446655440099 at 2026-07-22T11:00:00.000Z",
      eventKind: "request_cancelled",
      severity: "warning",
    });
    expect(a).toBe(b);
  });

  test("different sources do not share a fingerprint", () => {
    const a = computeFailureFingerprint({
      kind: "runtime_event",
      sourceId: "hermes",
      summary: "slots saturated",
      eventKind: "slots_saturated",
      severity: "warning",
    });
    const b = computeFailureFingerprint({
      kind: "runtime_event",
      sourceId: "grok",
      summary: "slots saturated",
      eventKind: "slots_saturated",
      severity: "warning",
    });
    expect(a).not.toBe(b);
  });

  test("inference fingerprints include status and model", () => {
    const a = computeFailureFingerprint({
      kind: "inference_request",
      sourceId: "hermes",
      summary: "error on gpt-test (client)",
      detail: "boom",
      status: "error",
      model: "gpt-test",
    });
    const b = computeFailureFingerprint({
      kind: "inference_request",
      sourceId: "hermes",
      summary: "error on gpt-test (other)",
      detail: "boom",
      status: "error",
      model: "gpt-test",
    });
    // summary differs by client label — normalized message differs
    // structured status+model still in fingerprint
    expect(a.startsWith("inference_request|hermes|error|gpt-test|")).toBe(true);
    expect(b.startsWith("inference_request|hermes|error|gpt-test|")).toBe(true);
  });

  test("activity fingerprints normalize variable ids in description", () => {
    const a = computeFailureFingerprint({
      kind: "activity",
      sourceId: "claude-code",
      summary: "tool failed for session 550e8400-e29b-41d4-a716-446655440000",
    });
    const b = computeFailureFingerprint({
      kind: "activity",
      sourceId: "claude-code",
      summary: "tool failed for session 660e8400-e29b-41d4-a716-446655440099",
    });
    expect(a).toBe(b);
    expect(a).toBe("activity|claude-code|tool failed for session <id>");
  });

  test("Claude tool-result failures with different toolu_ ids share a fingerprint", () => {
    const a = computeFailureFingerprint({
      kind: "activity",
      sourceId: "claude-code",
      summary: "Tool result for toolu_01AAA1111111111111111111",
      detail: "Command failed with exit code 1",
    });
    const b = computeFailureFingerprint({
      kind: "activity",
      sourceId: "claude-code",
      summary: "Tool result for toolu_01BBB2222222222222222222",
      detail: "Command failed with exit code 1",
    });
    expect(a).toBe(b);
    expect(a).toContain("<tool_id>");
  });

  test("Grok call_ ids collapse for activity tool failures", () => {
    const a = computeFailureFingerprint({
      kind: "activity",
      sourceId: "grok",
      summary: "tool_call failed call_xyz111 status error",
    });
    const b = computeFailureFingerprint({
      kind: "activity",
      sourceId: "grok",
      summary: "tool_call failed call_xyz999 status error",
    });
    expect(a).toBe(b);
  });
});

describe("classifyFailureSignal", () => {
  test("marks request_cancelled and cancelled inference as expected", () => {
    expect(
      classifyFailureSignal({
        kind: "runtime_event",
        eventKind: "request_cancelled",
        summary: "cancelled",
      }),
    ).toBe("expected");
    expect(
      classifyFailureSignal({
        kind: "inference_request",
        status: "cancelled",
        summary: "cancelled on model (client)",
      }),
    ).toBe("expected");
  });

  test("marks slots_saturated as transient", () => {
    expect(
      classifyFailureSignal({
        kind: "runtime_event",
        eventKind: "slots_saturated",
        summary: "slots saturated",
      }),
    ).toBe("transient");
  });

  test("defaults tool errors to actionable", () => {
    expect(
      classifyFailureSignal({
        kind: "activity",
        summary: "Tool result for toolu_01AAA",
        detail: "ENOENT",
      }),
    ).toBe("actionable");
  });

  test("interrupted tool results are expected", () => {
    expect(
      classifyFailureSignal({
        kind: "activity",
        summary: "Tool result for toolu_01AAA",
        detail: "interrupted by user",
      }),
    ).toBe("expected");
  });
});

describe("isFailureEventResolved", () => {
  test("runtime events resolve when endedAt is set", () => {
    expect(
      isFailureEventResolved({
        kind: "runtime_event",
        endedAt: "2026-07-21T02:00:00.000Z",
      }),
    ).toBe(true);
    expect(
      isFailureEventResolved({ kind: "runtime_event", endedAt: null }),
    ).toBe(false);
  });

  test("activity and inference are never resolved", () => {
    expect(
      isFailureEventResolved({
        kind: "activity",
        endedAt: "2026-07-21T02:00:00.000Z",
      }),
    ).toBe(false);
    expect(
      isFailureEventResolved({
        kind: "inference_request",
        endedAt: "2026-07-21T02:00:00.000Z",
      }),
    ).toBe(false);
  });
});
