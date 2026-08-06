/**
 * Privacy / security policy resolution (BSH-100).
 *
 * Config comes from environment only (no secrets in logs). Defaults are
 * intentionally conservative for production while remaining usable for
 * local single-user development with auth disabled.
 *
 * Environment variables:
 *   MC_REDACTION_MODE              off | standard | strict (default: standard)
 *   MC_RETENTION_ACTIVITIES_DAYS   default 90
 *   MC_RETENTION_SESSIONS_DAYS     default 90
 *   MC_RETENTION_INFERENCE_DAYS    default 90
 *   MC_RETENTION_RUNTIME_DAYS      default 7  (matches prior hard-coded window)
 *   MC_RETENTION_GENERATIONS_DAYS  default 90
 *   MC_RETENTION_JOBS_DAYS         default 90
 *   MC_REQUIRE_AUTH_IN_PRODUCTION  "true" to refuse start when auth is off in prod
 *   MC_AUTH_ENABLED / MC_PASSWORD_HASH / MC_VIEWER_*  (see auth.ts)
 */

export type RedactionMode = "off" | "standard" | "strict";

export type DataClass =
  | "activities"
  | "sessions"
  | "inference"
  | "runtime"
  | "generations"
  | "jobs";

export interface RetentionPolicy {
  activitiesDays: number;
  sessionsDays: number;
  inferenceDays: number;
  runtimeDays: number;
  generationsDays: number;
  jobsDays: number;
}

export interface PrivacyPolicy {
  redactionMode: RedactionMode;
  /** When true, redact secrets/tokens in free text and JSON. */
  redactSecrets: boolean;
  /** When true, redact absolute filesystem paths in free text. */
  redactPaths: boolean;
  /** When true, truncate/redact prompt & message body text. */
  redactPrompts: boolean;
  /** When true, strip or heavily truncate tool args/results. */
  redactToolPayloads: boolean;
  /** Prefer project label over full cwd in list responses. */
  hideRawCwdInLists: boolean;
  retention: RetentionPolicy;
  /** Production + auth disabled → refuse to start. */
  requireAuthInProduction: boolean;
  isProduction: boolean;
}

const DEFAULT_RETENTION: RetentionPolicy = {
  activitiesDays: 90,
  sessionsDays: 90,
  inferenceDays: 90,
  runtimeDays: 7,
  generationsDays: 90,
  jobsDays: 90,
};

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw == null || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  // Cap at 10 years to avoid accidental "never delete" via huge numbers
  return Math.min(n, 3650);
}

function parseRedactionMode(raw: string | undefined): RedactionMode {
  const v = (raw ?? "standard").toLowerCase().trim();
  if (v === "off" || v === "standard" || v === "strict") return v;
  return "standard";
}

/**
 * Resolve privacy policy from environment. Never logs secrets.
 */
export function resolvePrivacyPolicy(
  env: NodeJS.ProcessEnv = process.env,
): PrivacyPolicy {
  const mode = parseRedactionMode(env.MC_REDACTION_MODE);
  const isProduction = env.NODE_ENV === "production";

  return {
    redactionMode: mode,
    redactSecrets: mode !== "off",
    redactPaths: mode !== "off",
    // Prompt bodies only in strict — standard keeps short descriptions for UX
    // but still scrubs secrets/paths inside them.
    redactPrompts: mode === "strict",
    redactToolPayloads: mode !== "off",
    hideRawCwdInLists: true,
    retention: {
      activitiesDays: parsePositiveInt(
        env.MC_RETENTION_ACTIVITIES_DAYS,
        DEFAULT_RETENTION.activitiesDays,
      ),
      sessionsDays: parsePositiveInt(
        env.MC_RETENTION_SESSIONS_DAYS,
        DEFAULT_RETENTION.sessionsDays,
      ),
      inferenceDays: parsePositiveInt(
        env.MC_RETENTION_INFERENCE_DAYS,
        DEFAULT_RETENTION.inferenceDays,
      ),
      runtimeDays: parsePositiveInt(
        env.MC_RETENTION_RUNTIME_DAYS,
        DEFAULT_RETENTION.runtimeDays,
      ),
      generationsDays: parsePositiveInt(
        env.MC_RETENTION_GENERATIONS_DAYS,
        DEFAULT_RETENTION.generationsDays,
      ),
      jobsDays: parsePositiveInt(
        env.MC_RETENTION_JOBS_DAYS,
        DEFAULT_RETENTION.jobsDays,
      ),
    },
    requireAuthInProduction: env.MC_REQUIRE_AUTH_IN_PRODUCTION === "true",
    isProduction,
  };
}

/**
 * Safe snapshot for health/settings UI — no secrets, no password hashes.
 */
export function privacyPolicyPublicSnapshot(
  policy: PrivacyPolicy,
  auth: { enabled: boolean; hasViewer: boolean },
): {
  redactionMode: RedactionMode;
  redactSecrets: boolean;
  redactPaths: boolean;
  redactPrompts: boolean;
  redactToolPayloads: boolean;
  hideRawCwdInLists: boolean;
  retention: RetentionPolicy;
  authEnabled: boolean;
  hasViewerRole: boolean;
  isProduction: boolean;
  requireAuthInProduction: boolean;
  unsafeUnauthenticated: boolean;
} {
  return {
    redactionMode: policy.redactionMode,
    redactSecrets: policy.redactSecrets,
    redactPaths: policy.redactPaths,
    redactPrompts: policy.redactPrompts,
    redactToolPayloads: policy.redactToolPayloads,
    hideRawCwdInLists: policy.hideRawCwdInLists,
    retention: { ...policy.retention },
    authEnabled: auth.enabled,
    hasViewerRole: auth.hasViewer,
    isProduction: policy.isProduction,
    requireAuthInProduction: policy.requireAuthInProduction,
    unsafeUnauthenticated: policy.isProduction && !auth.enabled,
  };
}

/**
 * Enforce production auth policy at process start.
 * Throws when requireAuthInProduction is set and auth is disabled.
 * Returns a human-readable warning string when production has auth off
 * but hard-fail is not required (caller should log it).
 */
export function checkProductionAuthPolicy(
  policy: PrivacyPolicy,
  authEnabled: boolean,
): { ok: true; warning?: string } | { ok: false; error: string } {
  if (!policy.isProduction || authEnabled) {
    return { ok: true };
  }

  if (policy.requireAuthInProduction) {
    return {
      ok: false,
      error:
        "Refusing to start: NODE_ENV=production with MC_AUTH_ENABLED!=true " +
        "and MC_REQUIRE_AUTH_IN_PRODUCTION=true. Enable auth or unset the " +
        "require flag. See docs/DEPLOYMENT.md (Privacy & access).",
    };
  }

  return {
    ok: true,
    warning:
      "SECURITY WARNING: Authentication is DISABLED in production. " +
      "Any network client that can reach this server can read prompts, " +
      "tool payloads, and working-directory paths. Set MC_AUTH_ENABLED=true " +
      "and MC_PASSWORD_HASH, or set MC_REQUIRE_AUTH_IN_PRODUCTION=true to " +
      "refuse this configuration.",
  };
}
