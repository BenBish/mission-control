/**
 * Date-range helpers for Consumption and Direct API Spend.
 *
 * Two deliberately separate semantics:
 *
 * 1. **Agent usage** — absolute ISO timestamps compared to activity /
 *    inference `timestamp` columns. "Today" is the start of the browser's
 *    local calendar day (session work feels local).
 *
 * 2. **Provider usage** — calendar day keys (`YYYY-MM-DD`) compared to
 *    `provider_usage_daily.day`. Those days are stored as **UTC billing
 *    days** from provider APIs. "Today" is therefore the current UTC
 *    calendar day — never browser-local midnight serialized to ISO and
 *    then truncated (which drifts one day for positive UTC offsets).
 */

export type DatePreset = "today" | "7d" | "30d" | "all";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** UTC calendar day key `YYYY-MM-DD` for a Date. */
export function utcDayKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Normalize a provider `since` query value to a `YYYY-MM-DD` day key.
 *
 * - Pure day keys pass through.
 * - ISO datetimes use the UTC calendar day of that instant (compatible
 *   with absolute rolling windows; clients should prefer day keys for
 *   calendar presets like "today").
 */
export function toProviderDayKey(since: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(since)) return since;
  const parsed = new Date(since);
  if (!Number.isNaN(parsed.getTime())) return utcDayKey(parsed);
  // Last resort for date-prefixed garbage: first 10 chars if they look right.
  if (/^\d{4}-\d{2}-\d{2}/.test(since)) return since.slice(0, 10);
  return since;
}

/**
 * ISO timestamp lower bound for agent usage / activity filters.
 *
 * - `today` → start of the browser's local calendar day
 * - `7d` / `30d` → now minus N × 24h (absolute rolling window)
 * - `all` → undefined (no lower bound)
 */
export function getAgentUsageSince(
  preset: DatePreset,
  now: Date = new Date(),
): string | undefined {
  if (preset === "all") return undefined;
  if (preset === "today") {
    const start = new Date(now.getTime());
    start.setHours(0, 0, 0, 0);
    return start.toISOString();
  }
  const days = preset === "7d" ? 7 : 30;
  return new Date(now.getTime() - days * MS_PER_DAY).toISOString();
}

/**
 * Provider day-key lower bound (`YYYY-MM-DD`, UTC calendar days).
 *
 * - `today` → current UTC calendar day only
 * - `7d` / `30d` → UTC day of (now − N × 24h), matching prior rolling windows
 * - `all` → undefined
 *
 * Never derives "today" from local-midnight ISO, which for Europe/London
 * (BST, UTC+1) becomes the prior UTC day after `toISOString()` + slice.
 */
export function getProviderUsageSinceDay(
  preset: DatePreset,
  now: Date = new Date(),
): string | undefined {
  if (preset === "all") return undefined;
  if (preset === "today") return utcDayKey(now);
  const days = preset === "7d" ? 7 : 30;
  return utcDayKey(new Date(now.getTime() - days * MS_PER_DAY));
}
