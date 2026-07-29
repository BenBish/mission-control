import { useEffect, useState } from "react";

/** Default tick: re-evaluate wall-clock dependent UI every 30s. */
export const DEFAULT_NOW_TICK_MS = 30_000;

/**
 * Returns a `Date.now()` value that updates on an interval so age-based UI
 * (e.g. source heartbeat health) re-renders even when fetched data is unchanged.
 */
export function useNow(intervalMs: number = DEFAULT_NOW_TICK_MS): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
