/**
 * Shared HTTP helpers for provider connectors.
 * Errors never include Authorization headers or raw API keys.
 */

import { type FetchImpl, type ProviderId, ProviderHttpError } from "./types.js";

export async function providerFetchJson(
  provider: ProviderId,
  url: string,
  init: RequestInit,
  fetchImpl: FetchImpl = fetch,
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(url, init);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ProviderHttpError(
      provider,
      0,
      `Network error contacting ${provider}: ${sanitizeMessage(msg)}`,
    );
  }

  if (!res.ok) {
    let bodySnippet = "";
    try {
      bodySnippet = (await res.text()).slice(0, 200);
    } catch {
      // ignore
    }
    const hint =
      res.status === 401 || res.status === 403
        ? "auth failed"
        : res.status === 429
          ? "rate limited"
          : `HTTP ${res.status}`;
    throw new ProviderHttpError(
      provider,
      res.status,
      `${provider} ${hint}${bodySnippet ? `: ${sanitizeMessage(bodySnippet)}` : ""}`,
    );
  }

  return res.json();
}

/** Strip common secret-shaped substrings from error text before persistence. */
export function sanitizeMessage(text: string): string {
  return text
    .replace(/sk-[a-zA-Z0-9_-]{8,}/g, "sk-***")
    .replace(/Bearer\s+[^\s]+/gi, "Bearer ***")
    .replace(/x-api-key["']?\s*[:=]\s*["']?[^"'\s]+/gi, "x-api-key=***");
}

export function toUtcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function unixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}
