/**
 * API Client
 * Wraps fetch with 401 handling — redirects to login on authentication failure.
 */

let onUnauthorized: (() => void) | null = null;

/**
 * Get the API base URL.
 * - In development: empty string (Vite proxy handles /api/* → localhost:3001)
 * - In production: VITE_API_BASE_URL (e.g. "https://api.mission-control.example.com")
 */
export function getApiBaseUrl(): string {
  return import.meta.env.VITE_API_BASE_URL || "";
}

/**
 * Build a full API URL from a relative path.
 * @param path - e.g. "/api/activities" or "/api/stats?limit=5"
 */
export function apiUrl(path: string): string {
  return `${getApiBaseUrl()}${path}`;
}

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
  const url = typeof input === "string" ? apiUrl(input) : input;
  const res = await fetch(url, {
    ...init,
    credentials: "include",
  });

  if (res.status === 401 && onUnauthorized) {
    // Avoid triggering on auth endpoints themselves
    const urlStr = typeof input === "string" ? input : input.toString();
    if (!urlStr.includes("/api/auth/")) {
      onUnauthorized();
    }
  }

  return res;
}
