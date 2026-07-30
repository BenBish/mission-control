import { describe, expect, test } from "bun:test";
import {
  FAILURE_STATUS_SCOPE_LABEL,
  failureStatusScopeLabel,
  type FailureSummary,
} from "../../types/failures.js";

function baseSummary(overrides: Partial<FailureSummary> = {}): FailureSummary {
  return {
    total: 0,
    last24Hours: 0,
    openRuntimeEvents: 0,
    byKind: {
      activity: 0,
      inference_request: 0,
      runtime_event: 0,
    },
    definitions: {
      total: "all-time matching failures",
      last24Hours: "matching failures with timestamp >= now-24h",
      openRuntimeEvents:
        "runtime_events with severity != info and ended_at IS NULL",
      statusScope:
        "activity failure | inference non-success | runtime non-info",
    },
    ...overrides,
  };
}

describe("failureStatusScopeLabel", () => {
  test("formats API statusScope with middots", () => {
    expect(failureStatusScopeLabel(baseSummary())).toBe(
      "activity failure · inference non-success · runtime non-info",
    );
  });

  test("falls back when summary or scope is missing", () => {
    expect(failureStatusScopeLabel(null)).toBe(FAILURE_STATUS_SCOPE_LABEL);
    expect(failureStatusScopeLabel(undefined)).toBe(FAILURE_STATUS_SCOPE_LABEL);
    expect(
      failureStatusScopeLabel(
        baseSummary({
          definitions: {
            total: "x",
            last24Hours: "y",
            openRuntimeEvents: "z",
            statusScope: "   ",
          },
        }),
      ),
    ).toBe(FAILURE_STATUS_SCOPE_LABEL);
  });
});
