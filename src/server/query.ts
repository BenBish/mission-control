/**
 * Parse an optional query string. Empty / whitespace-only values are treated
 * as absent so `?sourceId=` means “all sources”, not filter to "".
 */
export function optionalQueryString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export type OptionalPositiveIntResult =
  | { ok: true; value: number | undefined }
  | { ok: false; error: string };

/**
 * Upper bound for optional positive int query params such as `limit`.
 * Prevents pathologically large LIMIT values from stressing SQLite/list endpoints.
 */
export const MAX_QUERY_LIMIT = 1000;

/**
 * Parse an optional positive integer query param (e.g. `limit`).
 *
 * - Missing / empty → `{ ok: true, value: undefined }` (caller uses default)
 * - Valid positive integer string or number → `{ ok: true, value: n }`
 *   (clamped to `max`, default {@link MAX_QUERY_LIMIT})
 * - Non-finite, non-integer, ≤0, or non-scalar → `{ ok: false, error }`
 *
 * Never returns NaN. Safe to bind the result into SQL LIMIT only when ok.
 */
export function parseOptionalPositiveInt(
  value: unknown,
  paramName = "limit",
  max: number = MAX_QUERY_LIMIT,
): OptionalPositiveIntResult {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: undefined };
  }

  // Express may surface repeated keys as string[]
  if (Array.isArray(value)) {
    return {
      ok: false,
      error: `${paramName} must be a single positive integer`,
    };
  }

  if (typeof value === "object") {
    return {
      ok: false,
      error: `${paramName} must be a positive integer`,
    };
  }

  const raw =
    typeof value === "string"
      ? value.trim()
      : typeof value === "number"
        ? String(value)
        : String(value);

  if (raw === "") {
    return { ok: true, value: undefined };
  }

  // Reject scientific notation and decimals that Number would accept partially
  if (!/^-?\d+$/.test(raw)) {
    return {
      ok: false,
      error: `${paramName} must be a positive integer`,
    };
  }

  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    return {
      ok: false,
      error: `${paramName} must be a positive integer`,
    };
  }

  const ceiling =
    typeof max === "number" &&
    Number.isFinite(max) &&
    Number.isInteger(max) &&
    max > 0
      ? max
      : MAX_QUERY_LIMIT;

  return { ok: true, value: Math.min(n, ceiling) };
}

/**
 * Parse an optional non-negative integer (e.g. `offset`).
 * Accepts 0; rejects negatives and non-integers.
 */
export function parseOptionalNonNegativeInt(
  value: unknown,
  paramName = "offset",
  max: number = 1_000_000,
): OptionalPositiveIntResult {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: undefined };
  }

  if (Array.isArray(value)) {
    return {
      ok: false,
      error: `${paramName} must be a single non-negative integer`,
    };
  }

  if (typeof value === "object") {
    return {
      ok: false,
      error: `${paramName} must be a non-negative integer`,
    };
  }

  const raw =
    typeof value === "string"
      ? value.trim()
      : typeof value === "number"
        ? String(value)
        : String(value);

  if (raw === "") {
    return { ok: true, value: undefined };
  }

  if (!/^\d+$/.test(raw)) {
    return {
      ok: false,
      error: `${paramName} must be a non-negative integer`,
    };
  }

  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    return {
      ok: false,
      error: `${paramName} must be a non-negative integer`,
    };
  }

  const ceiling =
    typeof max === "number" &&
    Number.isFinite(max) &&
    Number.isInteger(max) &&
    max >= 0
      ? max
      : 1_000_000;

  return { ok: true, value: Math.min(n, ceiling) };
}
