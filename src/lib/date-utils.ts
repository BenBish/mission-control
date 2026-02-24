/**
 * Date formatting utilities for the dashboard.
 *
 * Centralises date parsing, validation, and relative-time formatting
 * so that agent cards, detail pages, and sort comparators all behave
 * consistently — especially for null / empty / malformed timestamps.
 */

/**
 * Parse a date string and return a valid Date, or null if unparseable.
 */
export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Format a timestamp as a human-readable relative time string.
 *
 * Returns "Never" for null / undefined / empty / invalid timestamps,
 * ensuring the UI never displays "Invalid Date".
 */
export function formatLastActive(timestamp: string | null | undefined): string {
  const date = parseDate(timestamp);
  if (!date) return "Never";

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();

  // Future timestamps (clock skew) — show "Just now" rather than confusing negatives
  if (diffMs < 0) return "Just now";

  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

/**
 * Compare two date strings for sorting purposes.
 *
 * Null / empty / invalid dates sort to the bottom (treated as epoch 0).
 */
export function compareDates(
  a: string | null | undefined,
  b: string | null | undefined,
): number {
  const dateA = parseDate(a);
  const dateB = parseDate(b);
  const timeA = dateA ? dateA.getTime() : 0;
  const timeB = dateB ? dateB.getTime() : 0;
  return timeA - timeB;
}
