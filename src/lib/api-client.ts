/**
 * API Client
 * Wraps fetch with 401 handling — redirects to login on authentication failure.
 */

let onUnauthorized: (() => void) | null = null;

/**
 * Register a callback that is called when a 401 is received.
 * Used by AuthContext to trigger re-auth flow.
 */
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

/**
 * Fetch wrapper that handles 401 responses globally.
 * Use this instead of raw fetch() for API calls.
 */
export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const res = await fetch(input, {
    ...init,
    credentials: "include",
  });

  if (res.status === 401 && onUnauthorized) {
    // Avoid triggering on auth endpoints themselves
    const url = typeof input === "string" ? input : input.toString();
    if (!url.includes("/api/auth/")) {
      onUnauthorized();
    }
  }

  return res;
}
