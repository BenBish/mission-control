/**
 * Ingestion-time redaction for secrets, paths, prompts, and tool payloads.
 * Applied before rows hit SQLite so the DB is not a second ungoverned store.
 */

import type { PrivacyPolicy } from "./policy.js";
import type {
  ActivityPayload,
  SessionPayload,
  JobRunPayload,
  InferenceRequestPayload,
} from "../../types/ingest.js";
import { projectLabelFromCwd } from "../../lib/model-identity.js";

export const REDACTED = "[REDACTED]";
export const REDACTED_PATH = "[PATH]";
const DEFAULT_PROMPT_MAX = 120;
const DEFAULT_TOOL_STRING_MAX = 200;

/** Common secret / credential patterns (case-insensitive where noted). */
const SECRET_PATTERNS: RegExp[] = [
  // Bearer / basic auth headers
  /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /\bBasic\s+[A-Za-z0-9+/]+=*/gi,
  // OpenAI / Anthropic / common API key shapes
  /\bsk-[A-Za-z0-9_\-]{16,}\b/g,
  /\bsk-ant-[A-Za-z0-9_\-]{16,}\b/g,
  /\bsk-or-[A-Za-z0-9_\-]{16,}\b/g,
  /\bxai-[A-Za-z0-9_\-]{16,}\b/g,
  /\bghp_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bglpat-[A-Za-z0-9_\-]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9\-]{10,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  // Generic key/secret assignments in free text
  /\b(api[_-]?key|secret[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|pwd|authorization)\s*[:=]\s*['"]?[^\s'"]{8,}/gi,
  // JWT-looking triples
  /\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}/g,
];

/** Absolute Unix / Windows paths (conservative — avoid eating URLs). */
const PATH_PATTERNS: RegExp[] = [
  // Unix absolute paths with at least one more segment
  /(?<![\w:/])(\/(?:home|Users|var|tmp|opt|root|etc|usr)\/[^\s"'`]+)/g,
  // Windows drive paths
  /\b([A-Za-z]:\\(?:[^\s"'`\\]+\\?)+)/g,
  // file:// URLs
  /\bfile:\/\/\/[^\s"'`]+/gi,
];

export function redactSecretsInString(input: string): string {
  let out = input;
  for (const re of SECRET_PATTERNS) {
    // Reset lastIndex for global regexes reused across calls
    re.lastIndex = 0;
    out = out.replace(re, REDACTED);
  }
  return out;
}

export function redactPathsInString(input: string): string {
  let out = input;
  for (const re of PATH_PATTERNS) {
    re.lastIndex = 0;
    out = out.replace(re, REDACTED_PATH);
  }
  return out;
}

export function truncateText(input: string, max: number): string {
  if (input.length <= max) return input;
  return `${input.slice(0, max)}…[truncated]`;
}

/**
 * Apply string-level policy (secrets/paths/optional truncation).
 */
export function redactText(
  input: string | undefined | null,
  policy: PrivacyPolicy,
  opts?: { maxLen?: number; forceTruncate?: boolean },
): string | undefined {
  if (input == null) return undefined;
  let out = input;
  if (policy.redactSecrets) out = redactSecretsInString(out);
  if (policy.redactPaths) out = redactPathsInString(out);
  if (
    opts?.forceTruncate ||
    (opts?.maxLen != null && out.length > opts.maxLen)
  ) {
    out = truncateText(out, opts?.maxLen ?? DEFAULT_PROMPT_MAX);
  }
  return out;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Deep-walk JSON-like values, redacting string leaves and known sensitive keys.
 */
export function redactJsonValue(
  value: unknown,
  policy: PrivacyPolicy,
  opts?: { maxStringLen?: number; stripToolBodies?: boolean },
): unknown {
  if (value == null) return value;
  if (typeof value === "string") {
    return (
      redactText(value, policy, {
        maxLen: opts?.maxStringLen,
        forceTruncate: opts?.maxStringLen != null,
      }) ?? value
    );
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.map((v) => redactJsonValue(v, policy, opts));
  }
  if (!isPlainObject(value)) return value;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    const keyLower = k.toLowerCase();
    const sensitiveKey =
      /^(password|passwd|pwd|secret|token|api[_-]?key|authorization|auth|cookie|credentials?)$/i.test(
        keyLower,
      ) ||
      keyLower.includes("password") ||
      keyLower.includes("secret") ||
      keyLower.includes("api_key") ||
      keyLower.includes("apikey") ||
      keyLower.includes("access_token");

    if (sensitiveKey && typeof v === "string") {
      out[k] = REDACTED;
      continue;
    }

    // Tool I/O fields — strip or heavily truncate under standard/strict
    const toolBodyKey =
      keyLower === "arguments" ||
      keyLower === "args" ||
      keyLower === "stdout" ||
      keyLower === "stderr" ||
      keyLower === "output" ||
      keyLower === "input" ||
      keyLower === "content" ||
      keyLower === "prompt" ||
      keyLower === "text";

    if (opts?.stripToolBodies && toolBodyKey) {
      if (typeof v === "string") {
        out[k] = policy.redactPrompts
          ? REDACTED
          : (redactText(v, policy, { maxLen: DEFAULT_TOOL_STRING_MAX }) ??
            REDACTED);
      } else if (v != null) {
        out[k] = policy.redactPrompts
          ? REDACTED
          : redactJsonValue(v, policy, {
              ...opts,
              maxStringLen: DEFAULT_TOOL_STRING_MAX,
            });
      } else {
        out[k] = v;
      }
      continue;
    }

    out[k] = redactJsonValue(v, policy, opts);
  }
  return out;
}

const PROMPT_ACTION_TYPES = new Set(["user_request", "message", "decision"]);

/**
 * Redact an activity payload for storage.
 */
export function redactActivityPayload(
  payload: ActivityPayload,
  policy: PrivacyPolicy,
): ActivityPayload {
  if (policy.redactionMode === "off") return payload;

  const isPromptLike = PROMPT_ACTION_TYPES.has(payload.actionType);
  const descMax =
    policy.redactPrompts && isPromptLike
      ? DEFAULT_PROMPT_MAX
      : isPromptLike
        ? 500
        : undefined;

  const description =
    redactText(payload.description, policy, {
      maxLen: descMax,
      forceTruncate: descMax != null && policy.redactPrompts && isPromptLike,
    }) ?? payload.description;

  let details = payload.details;
  let result = payload.result;
  let metadata = payload.metadata;

  if (policy.redactToolPayloads || policy.redactSecrets || policy.redactPaths) {
    if (details !== undefined) {
      details = redactJsonValue(details, policy, {
        stripToolBodies: policy.redactToolPayloads,
        maxStringLen: policy.redactToolPayloads
          ? DEFAULT_TOOL_STRING_MAX
          : undefined,
      }) as ActivityPayload["details"];
    }
    if (result !== undefined) {
      result = redactJsonValue(result, policy, {
        stripToolBodies: policy.redactToolPayloads,
        maxStringLen: policy.redactToolPayloads
          ? DEFAULT_TOOL_STRING_MAX
          : undefined,
      }) as ActivityPayload["result"];
    }
    if (metadata !== undefined) {
      metadata = redactJsonValue(metadata, policy, {
        stripToolBodies: false,
      }) as ActivityPayload["metadata"];
    }
  }

  // In strict mode, drop tool bodies entirely for tool_call actions
  if (policy.redactPrompts && payload.actionType === "tool_call") {
    if (isPlainObject(details)) {
      const d = { ...details } as Record<string, unknown>;
      for (const k of ["arguments", "args", "input", "content"]) {
        if (k in d) d[k] = REDACTED;
      }
      details = d;
    }
    if (result !== undefined) {
      result = { redacted: true } as ActivityPayload["result"];
    }
  }

  return {
    ...payload,
    description,
    details,
    result,
    metadata,
  };
}

/**
 * Session: keep full cwd in DB for internal joins/project labels, but
 * scrub secrets from title if present. Path policy is applied at read time
 * for list views (project alias).
 */
export function redactSessionPayload(
  payload: SessionPayload,
  policy: PrivacyPolicy,
): SessionPayload {
  if (policy.redactionMode === "off") return payload;
  return {
    ...payload,
    title: redactText(payload.title, policy) ?? payload.title,
    // Never store secrets that somehow land in cwd
    cwd: payload.cwd
      ? (redactSecretsInString(payload.cwd) as string)
      : payload.cwd,
  };
}

export function redactJobRunPayload(
  payload: JobRunPayload,
  policy: PrivacyPolicy,
): JobRunPayload {
  if (policy.redactionMode === "off") return payload;
  return {
    ...payload,
    output: redactText(payload.output, policy, {
      maxLen: policy.redactToolPayloads ? DEFAULT_TOOL_STRING_MAX : undefined,
    }),
    error: redactText(payload.error, policy),
    details:
      payload.details !== undefined
        ? (redactJsonValue(payload.details, policy, {
            stripToolBodies: policy.redactToolPayloads,
          }) as JobRunPayload["details"])
        : undefined,
  };
}

export function redactInferencePayload(
  payload: InferenceRequestPayload,
  policy: PrivacyPolicy,
): InferenceRequestPayload {
  if (policy.redactionMode === "off") return payload;
  return {
    ...payload,
    error: redactText(payload.error, policy),
    details:
      payload.details !== undefined
        ? (redactJsonValue(payload.details, policy, {
            stripToolBodies: policy.redactToolPayloads,
          }) as InferenceRequestPayload["details"])
        : undefined,
  };
}

/**
 * Presentational: strip raw sensitive fields for list / non-owner views.
 */
export function sanitizeActivityForClient(
  activity: Record<string, unknown>,
  opts: { includeSensitive: boolean; hideRawCwd: boolean },
): Record<string, unknown> {
  if (opts.includeSensitive) return activity;
  const { details: _d, result: _r, metadata: _m, ...rest } = activity;
  return {
    ...rest,
    details: undefined,
    result: undefined,
    metadata: undefined,
    sensitiveFieldsOmitted: true,
  };
}

export function sanitizeSessionForClient(
  session: Record<string, unknown>,
  opts: { includeSensitive: boolean; hideRawCwd: boolean },
): Record<string, unknown> {
  const cwd = session.cwd as string | null | undefined;
  const project = projectLabelFromCwd(cwd);
  // Always expose project label for UI. Raw cwd only when allowed.
  if (opts.hideRawCwd || !opts.includeSensitive) {
    return {
      ...session,
      cwd: undefined,
      project: project ?? null,
    };
  }
  return {
    ...session,
    cwd,
    project: project ?? null,
  };
}
