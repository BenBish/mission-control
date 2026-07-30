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
 * Parse an optional positive integer query param (e.g. `limit`).
 *
 * - Missing / empty → `{ ok: true, value: undefined }` (caller uses default)
 * - Valid positive integer string or number → `{ ok: true, value: n }`
 * - Non-finite, non-integer, ≤0, or non-scalar → `{ ok: false, error }`
 *
 * Never returns NaN. Safe to bind the result into SQL LIMIT only when ok.
 */
export function parseOptionalPositiveInt(
  value: unknown,
  paramName = "limit",
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

  return { ok: true, value: n };
}
