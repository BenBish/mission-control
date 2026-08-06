/**
 * Canonical model identity for Agent Usage ranking (BSH-99).
 *
 * Providers and collectors emit many raw aliases for the same model
 * (date-stamped Claude IDs, openrouter/ prefixes, provider/model pairs).
 * Ranking aggregates on a stable canonical key while raw values remain
 * available for diagnostics.
 */

export type ModelMateriality = "material" | "zero" | "synthetic";

export type ModelIdentity = {
  /** Stable aggregation key (lowercase, alias-collapsed). */
  canonical: string;
  /** Original value from the row (or "unknown" when missing). */
  raw: string;
  isUnknown: boolean;
  isSynthetic: boolean;
};

const SYNTHETIC_PATTERNS = [
  /^<?synthetic>?$/i,
  /^<synthetic>$/i,
  /^synthetic$/i,
];

const UNKNOWN_PATTERNS = [/^unknown$/i, /^n\/?a$/i, /^null$/i, /^undefined$/i];

/** Strip openrouter/ vendor prefixes and normalize separators. */
function stripProviderPrefix(id: string): string {
  let s = id.trim();
  // openrouter/anthropic/claude-x → anthropic/claude-x → claude-x when anthropic
  if (s.toLowerCase().startsWith("openrouter/")) {
    s = s.slice("openrouter/".length);
  }
  const lower = s.toLowerCase();
  for (const p of ["anthropic/", "openai/", "x-ai/", "xai/", "google/"]) {
    if (lower.startsWith(p)) {
      s = s.slice(p.length);
      break;
    }
  }
  return s;
}

/**
 * Collapse common dated/versioned aliases into a stable family key.
 * Examples:
 * - claude-3-5-sonnet-20241022 → claude-3.5-sonnet
 * - claude-sonnet-4-20250514 → claude-sonnet-4
 * - gpt-4o-2024-08-06 → gpt-4o
 */
function collapseVersionSuffixes(id: string): string {
  let s = id.toLowerCase().replace(/_/g, "-");

  // claude-3-5-sonnet → claude-3.5-sonnet (digit-digit family)
  s = s.replace(/claude-(\d+)-(\d+)-/g, "claude-$1.$2-");

  // Strip trailing ISO-ish date stamps: -20241022, -2024-08-06
  s = s.replace(/-\d{8}$/, "");
  s = s.replace(/-\d{4}-\d{2}-\d{2}$/, "");

  // Strip trailing build tags like -latest, -preview when after a version
  s = s.replace(/-(latest|preview|exp)$/, "");

  return s;
}

/**
 * Normalize a raw model string from activities / inference logs.
 */
export function normalizeModelIdentity(
  rawModel: string | null | undefined,
): ModelIdentity {
  if (rawModel == null || String(rawModel).trim() === "") {
    return {
      canonical: "unknown",
      raw: "unknown",
      isUnknown: true,
      isSynthetic: false,
    };
  }

  const raw = String(rawModel).trim();
  if (SYNTHETIC_PATTERNS.some((re) => re.test(raw))) {
    return {
      canonical: "synthetic",
      raw,
      isUnknown: false,
      isSynthetic: true,
    };
  }
  if (UNKNOWN_PATTERNS.some((re) => re.test(raw))) {
    return {
      canonical: "unknown",
      raw,
      isUnknown: true,
      isSynthetic: false,
    };
  }

  const stripped = stripProviderPrefix(raw);
  const canonical = collapseVersionSuffixes(stripped);
  if (!canonical || UNKNOWN_PATTERNS.some((re) => re.test(canonical))) {
    return {
      canonical: "unknown",
      raw,
      isUnknown: true,
      isSynthetic: false,
    };
  }

  return {
    canonical,
    raw,
    isUnknown: false,
    isSynthetic: false,
  };
}

/**
 * Project/workspace display label from a session cwd.
 * Returns the last path segment only — never the full working-directory path.
 */
export function projectLabelFromCwd(
  cwd: string | null | undefined,
): string | null {
  if (cwd == null || String(cwd).trim() === "") return null;
  const normalized = String(cwd).replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalized) return null;
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 0) return null;
  const base = parts[parts.length - 1];
  // Ignore empty / bare root
  if (!base || base === ".") return null;
  return base;
}

/**
 * Classify a usage row for default ranking filters.
 */
export function classifyMateriality(opts: {
  inputTokens: number;
  outputTokens: number;
  isSynthetic: boolean;
}): ModelMateriality {
  if (opts.isSynthetic) return "synthetic";
  if (opts.inputTokens + opts.outputTokens <= 0) return "zero";
  return "material";
}

/**
 * Attribution quality for a driver row.
 * Unknown model OR missing project when both dimensions empty counts as unattributed.
 */
export function isUnattributed(opts: {
  isUnknownModel: boolean;
  project: string | null;
  requireProject?: boolean;
}): boolean {
  if (opts.isUnknownModel) return true;
  if (opts.requireProject && !opts.project) return true;
  return false;
}

/**
 * Inclusive previous-period window for comparison views.
 * Given [since, until] as ISO timestamps, returns a window of the same
 * duration ending just before `since`.
 */
export function previousPeriodWindow(
  sinceIso: string,
  untilIso: string,
): { since: string; until: string } {
  const sinceMs = Date.parse(sinceIso);
  const untilMs = Date.parse(untilIso);
  if (Number.isNaN(sinceMs) || Number.isNaN(untilMs) || untilMs < sinceMs) {
    throw new Error(
      "previousPeriodWindow requires valid since/until ISO range",
    );
  }
  const duration = untilMs - sinceMs;
  const prevUntil = sinceMs - 1;
  const prevSince = prevUntil - duration;
  return {
    since: new Date(prevSince).toISOString(),
    until: new Date(prevUntil).toISOString(),
  };
}
