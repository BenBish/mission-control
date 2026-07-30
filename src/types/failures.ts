/**
 * Shared failure list + aggregate contract for API, query layer, and UI.
 */

export interface FailureItem {
  kind: "activity" | "inference_request" | "runtime_event";
  id: string;
  sourceId: string;
  timestamp: string;
  summary: string;
  detail?: string;
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
