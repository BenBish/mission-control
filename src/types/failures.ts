/**
 * Shared failure list + aggregate contract for API, query layer, and UI.
 */

import type { FailureSignalClass } from "../lib/failure-fingerprint.js";

export type FailureKind = "activity" | "inference_request" | "runtime_event";

export type FailureResolution = "resolved" | "unresolved";

/** Operator triage lifecycle for a fingerprint group (incident). */
export type FailureTriageStatus =
  | "open"
  | "acknowledged"
  | "snoozed"
  | "resolved";

export type { FailureSignalClass };

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
  /** Expected / transient / actionable classification. */
  signalClass?: FailureSignalClass;
}

export interface FailureIncidentState {
  fingerprint: string;
  triageStatus: FailureTriageStatus;
  owner?: string;
  resolutionReason?: string;
  runbookUrl?: string;
  notes?: string;
  acknowledgedAt?: string;
  snoozedUntil?: string;
  resolvedAt?: string;
  updatedAt?: string;
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
  /** Event-level: true when every member occurrence is resolved. */
  resolved: boolean;
  /** How many occurrences still open (not resolved). */
  openCount: number;
  /** Classification of the representative signal. */
  signalClass: FailureSignalClass;
  /** Operator triage state (defaults to open when no row exists). */
  triageStatus: FailureTriageStatus;
  owner?: string;
  resolutionReason?: string;
  runbookUrl?: string;
  notes?: string;
  snoozedUntil?: string;
  acknowledgedAt?: string;
  resolvedAt?: string;
}

/** Signal-quality metrics for the Failure Analysis overview. */
export interface FailureSignalQuality {
  /** Groups after kind filter (before pagination); independent of resolution. */
  groupCount: number;
  /** Events / groups (0 when no groups). */
  avgEventsPerGroup: number;
  /** Groups with occurrenceCount >= 2. */
  recurringGroups: number;
  /** Actionable groups still open for triage (not ack/snoozed/resolved). */
  untriagedActionableGroups: number;
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
  /** Present on groups endpoint; optional on legacy raw list. */
  signalQuality?: FailureSignalQuality;
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

export interface UpdateFailureIncidentInput {
  triageStatus?: FailureTriageStatus;
  owner?: string | null;
  resolutionReason?: string | null;
  runbookUrl?: string | null;
  notes?: string | null;
  /** ISO timestamp or duration helper from client; null clears snooze. */
  snoozedUntil?: string | null;
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
