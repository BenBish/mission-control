/**
 * Shared failure list + aggregate contract for API, query layer, and UI.
 */

export type FailureKind = "activity" | "inference_request" | "runtime_event";

export type FailureResolution = "resolved" | "unresolved";

export interface FailureItem {
  kind: FailureKind;
  id: string;
  sourceId: string;
  timestamp: string;
  summary: string;
  detail?: string;
  /** Present when the underlying row has an end/resolution signal. */
  endedAt?: string;
  /** Stable group key; optional on legacy raw list responses. */
  fingerprint?: string;
  resolved?: boolean;
}

export interface FailureGroup {
  fingerprint: string;
  kind: FailureKind;
  sourceId: string;
  /** Representative summary (from most recent occurrence). */
  summary: string;
  /** Representative detail from most recent occurrence (may be long/JSON). */
  detail?: string;
  occurrenceCount: number;
  firstSeen: string;
  lastSeen: string;
  resolved: boolean;
  /** How many occurrences still open (not resolved). */
  openCount: number;
}

export interface FailureSummary {
  total: number;
  last24Hours: number;
  openRuntimeEvents: number;
  byKind: {
    activity: number;
    inference_request: number;
    runtime_event: number;
  };
  definitions: {
    total: string;
    last24Hours: string;
    openRuntimeEvents: string;
    statusScope: string;
  };
}

export interface FailuresResponse {
  failures: FailureItem[];
  summary: FailureSummary;
}

export interface FailureGroupsResponse {
  groups: FailureGroup[];
  /** Number of groups after filters (for pagination). */
  groupTotal: number;
  /** Event-level aggregate totals (independent of group pagination). */
  summary: FailureSummary;
}

export interface FailureGroupEventsResponse {
  fingerprint: string;
  events: FailureItem[];
  total: number;
}

/** Default labels when definitions are absent (should not happen on current API). */
export const FAILURE_STATUS_SCOPE_LABEL =
  "activity failure · inference non-success · runtime non-info";

export function failureStatusScopeLabel(
  summary?: FailureSummary | null,
): string {
  const scope = summary?.definitions?.statusScope?.trim();
  if (!scope) return FAILURE_STATUS_SCOPE_LABEL;
  // API uses " | "; UI prefers middots for readability.
  return scope.replace(/\s*\|\s*/g, " · ");
}
