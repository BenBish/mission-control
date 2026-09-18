/**
 * Minimal Cloud Handoff control plane client. Only the two endpoints the
 * collector needs: `GET /v1/sessions` and `GET /v1/sessions/:id/events`.
 * Both accept the CLI/operator bearer token from `handoff setup`.
 *
 * The events endpoint answers with a finite `text/event-stream` replay (not a
 * held-open stream), so it's read as text and the `data:` frames parsed as
 * SessionEvent JSON.
 */

import type { CloudHandoffConfig } from "./config.js";

export const DEFAULT_CLOUD_HANDOFF_FETCH_TIMEOUT_MS = 60_000;

/**
 * Per-request timeout. 15s proved too short for the events replay of large
 * sessions (a 1.4 MB stream took ~13s on a good path); 60s covers the initial
 * backlog fetch while `?after=` keeps steady-state fetches tiny.
 * CLOUD_HANDOFF_FETCH_TIMEOUT_MS overrides.
 */
export function cloudHandoffFetchTimeoutMs(
  env: Record<string, string | undefined> = process.env,
): number {
  const v = Number(env.CLOUD_HANDOFF_FETCH_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0
    ? v
    : DEFAULT_CLOUD_HANDOFF_FETCH_TIMEOUT_MS;
}

/** Subset of the control plane's CloudSession the collector reads. */
export interface CloudHandoffSession {
  id: string;
  status: string;
  task?: string;
  repository?: { owner?: string; name?: string };
  createdAt: string;
  updatedAt: string;
  branch?: string;
  pullRequestUrl?: string;
  summary?: string;
  error?: string;
  agentExecutionSnapshot?: {
    harness?: string;
    provider?: string;
    model?: string;
  };
}

/** One row of the SSE replay from GET /v1/sessions/:id/events. */
export interface CloudHandoffEvent {
  id: number;
  sessionId: string;
  type: string;
  createdAt: string;
  payload: Record<string, unknown>;
}

type FetchImpl = typeof fetch;

async function apiGet(
  config: CloudHandoffConfig,
  path: string,
  fetchImpl: FetchImpl,
): Promise<Response> {
  const res = await fetchImpl(`${config.url}${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: "application/json",
      "User-Agent": "mission-control-cloud-handoff-collector",
    },
    signal: AbortSignal.timeout(cloudHandoffFetchTimeoutMs()),
  });
  if (!res.ok) {
    const err = new Error(
      `cloud-handoff request failed: ${res.status} ${path}`,
    ) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res;
}

export async function fetchSessions(
  config: CloudHandoffConfig,
  fetchImpl: FetchImpl = fetch,
): Promise<CloudHandoffSession[]> {
  const res = await apiGet(config, "/v1/sessions", fetchImpl);
  const body = (await res.json()) as unknown;
  return Array.isArray(body) ? (body as CloudHandoffSession[]) : [];
}

/**
 * Parse the event stream body into records. Each frame is
 * `id: <n>\nevent: <type>\ndata: <json>`; only the `data:` line carries the
 * stored SessionEvent. Malformed frames are skipped rather than failing the
 * whole replay.
 */
export function parseEventStream(body: string): CloudHandoffEvent[] {
  const events: CloudHandoffEvent[] = [];
  for (const frame of body.split("\n\n")) {
    const dataLine = frame
      .split("\n")
      .find((line) => line.startsWith("data: "));
    if (!dataLine) continue;
    try {
      const parsed = JSON.parse(dataLine.slice(6)) as unknown;
      if (
        parsed &&
        typeof parsed === "object" &&
        typeof (parsed as CloudHandoffEvent).id === "number" &&
        typeof (parsed as CloudHandoffEvent).type === "string"
      ) {
        events.push(parsed as CloudHandoffEvent);
      }
    } catch {
      continue;
    }
  }
  return events;
}

export async function fetchSessionEvents(
  config: CloudHandoffConfig,
  sessionId: string,
  after: number,
  fetchImpl: FetchImpl = fetch,
): Promise<CloudHandoffEvent[]> {
  const res = await apiGet(
    config,
    `/v1/sessions/${encodeURIComponent(sessionId)}/events?after=${after}`,
    fetchImpl,
  );
  return parseEventStream(await res.text());
}
