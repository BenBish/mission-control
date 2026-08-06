/**
 * Stable failure fingerprints for grouping near-identical incidents.
 *
 * Fingerprint inputs (documented for operators and tests):
 * - kind: activity | inference_request | runtime_event
 * - sourceId
 * - kind-specific structured fields:
 *   - runtime_event → eventKind (e.g. slots_saturated), severity
 *   - inference_request → status, model
 *   - activity → (none beyond message)
 * - normalized free-text (summary + detail when present)
 *
 * Normalization collapses UUIDs, ISO timestamps, tool-use/result IDs
 * (toolu_*, call_*, fc_*), and long numeric/hex runs so repeated Claude
 * tool-result failures and cancellations share a group.
 *
 * Classification (signal class) is separate from fingerprinting:
 * expected / transient / actionable — used for triage prioritization.
 */

export type FailureKind = "activity" | "inference_request" | "runtime_event";

/** Operator-facing signal class for triage prioritization. */
export type FailureSignalClass = "actionable" | "expected" | "transient";

export interface FailureFingerprintInput {
  kind: FailureKind;
  sourceId: string;
  summary: string;
  detail?: string | null;
  /** runtime_events.kind — primary structured key for runtime failures */
  eventKind?: string | null;
  /** runtime_events.severity */
  severity?: string | null;
  /** inference_requests.status when not success */
  status?: string | null;
  /** inference_requests.model */
  model?: string | null;
}

export interface FailureSignalClassInput {
  kind: FailureKind;
  /** runtime_events.kind */
  eventKind?: string | null;
  /** inference_requests.status or activity status when available */
  status?: string | null;
  summary?: string | null;
  detail?: string | null;
}

const UUID_RE =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const ISO_TS_RE =
  /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?\b/g;
/** Claude tool_use / tool_result ids: toolu_01AbC... */
const TOOL_USE_ID_RE = /\btoolu_[a-zA-Z0-9]{8,}\b/g;
/** OpenAI/xAI function-call style ids: call_abc123, fc_abc123 */
const CALL_ID_RE = /\b(?:call|fc)_[a-zA-Z0-9]{6,}\b/g;
/** Generic "tool_use_id: xxx" / "toolUseId=xxx" key-value shapes */
const TOOL_USE_KV_RE =
  /\b(?:tool[_-]?use[_-]?id|toolUseId|tool_call_id|toolCallId)\s*[:=]\s*["']?[a-zA-Z0-9_-]{6,}["']?/gi;
const LONG_HEX_RE = /\b[0-9a-f]{16,}\b/gi;
const LONG_NUM_RE = /\b\d{4,}\b/g;

/**
 * Normalize free-text so near-identical messages share a fingerprint.
 */
export function normalizeFailureMessage(text: string): string {
  // Strip structured tokens before lowercasing so ISO `T`/`Z` still match.
  return text
    .replace(UUID_RE, "<id>")
    .replace(ISO_TS_RE, "<ts>")
    .replace(TOOL_USE_ID_RE, "<tool_id>")
    .replace(CALL_ID_RE, "<call_id>")
    .replace(TOOL_USE_KV_RE, "tool_use_id=<tool_id>")
    .replace(LONG_HEX_RE, "<hex>")
    .replace(LONG_NUM_RE, "<n>")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function part(value: string | null | undefined): string {
  const t = (value ?? "").trim();
  return t === "" ? "-" : t;
}

/**
 * Compute a stable, human-debuggable fingerprint string.
 * Format: kind|sourceId|structured…|normalizedMessage
 */
export function computeFailureFingerprint(
  input: FailureFingerprintInput,
): string {
  const source = part(input.sourceId);
  const message = normalizeFailureMessage(
    [input.summary, input.detail].filter(Boolean).join(" · "),
  );

  switch (input.kind) {
    case "runtime_event":
      // Prefer structured event kind so all slots_saturated rows group together
      // even when summary text drifts slightly.
      return [
        "runtime_event",
        source,
        part(input.eventKind),
        part(input.severity),
        message || "-",
      ].join("|");
    case "inference_request":
      return [
        "inference_request",
        source,
        part(input.status),
        part(input.model),
        message || "-",
      ].join("|");
    case "activity":
      return ["activity", source, message || "-"].join("|");
    default: {
      const _exhaustive: never = input.kind;
      return String(_exhaustive);
    }
  }
}

/**
 * Classify a failure signal for triage prioritization.
 *
 * - expected: user cancellations, interrupted tool results
 * - transient: capacity / slot saturation and similar short-lived runtime pressure
 * - actionable: everything else (default)
 */
export function classifyFailureSignal(
  input: FailureSignalClassInput,
): FailureSignalClass {
  const status = (input.status ?? "").trim().toLowerCase();
  const eventKind = (input.eventKind ?? "").trim().toLowerCase();
  const text = normalizeFailureMessage(
    [input.summary, input.detail].filter(Boolean).join(" "),
  );

  if (
    status === "cancelled" ||
    status === "canceled" ||
    eventKind === "request_cancelled" ||
    /\b(interrupted|user.?cancel|cancelled by user|canceled by user)\b/.test(
      text,
    )
  ) {
    return "expected";
  }

  if (
    eventKind === "slots_saturated" ||
    /\b(slots?\s*saturated|capacity|rate.?limit|too many requests|temporar(?:y|ily)|try again|econnreset|etimedout|socket hang up)\b/.test(
      text,
    )
  ) {
    return "transient";
  }

  return "actionable";
}

/** Group is resolved only when every member event is resolved. */
export function isFailureEventResolved(opts: {
  kind: FailureKind;
  endedAt?: string | null;
}): boolean {
  if (opts.kind === "runtime_event") {
    return opts.endedAt != null && String(opts.endedAt).trim() !== "";
  }
  // Activities and inference requests have no end/resolution field.
  return false;
}
