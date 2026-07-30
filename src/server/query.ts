/**
 * Parse an optional query string. Empty / whitespace-only values are treated
 * as absent so `?sourceId=` means “all sources”, not filter to "".
 */
export function optionalQueryString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}
