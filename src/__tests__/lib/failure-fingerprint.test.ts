import { describe, expect, test } from "bun:test";
import {
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
