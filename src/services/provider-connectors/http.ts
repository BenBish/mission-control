/**
 * Shared HTTP helpers for provider connectors.
 * Errors never include Authorization headers or raw API keys.
 */

import { type FetchImpl, type ProviderId, ProviderHttpError } from "./types.js";

/** Default outbound timeout for provider billing APIs. */
export const PROVIDER_FETCH_TIMEOUT_MS = 45_000;

export async function providerFetchJson(
  provider: ProviderId,
  url: string,
  init: RequestInit,
  fetchImpl: FetchImpl = fetch,
  timeoutMs: number = PROVIDER_FETCH_TIMEOUT_MS,
): Promise<unknown> {
  const controller = new AbortController();
  const externalSignal = init.signal;
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }
  }

  const timer =
    timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : undefined;

  let res: Response;
  try {
    res = await fetchImpl(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const aborted =
      (err instanceof Error && err.name === "AbortError") ||
      controller.signal.aborted;
    throw new ProviderHttpError(
      provider,
      0,
      aborted
        ? `${provider} request timed out after ${timeoutMs}ms`
        : `Network error contacting ${provider}: ${sanitizeMessage(msg)}`,
    );
  } finally {
    if (timer) clearTimeout(timer);
    if (externalSignal) {
      externalSignal.removeEventListener("abort", onExternalAbort);
    }
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

/** Inclusive UTC day bounds for filtering normalized activity rows. */
export function dayInWindow(
  day: string,
  window: { start: Date; end: Date },
): boolean {
  const startDay = toUtcDay(window.start);
  const endDay = toUtcDay(window.end);
  return day >= startDay && day <= endDay;
}
