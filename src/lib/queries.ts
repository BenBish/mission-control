/**
 * React Query hooks over the ingest API's read endpoints.
 *
 * Every hook mirrors its route's response envelope ({success, ...}) and
 * throws on non-2xx / success:false so react-query's error state just works.
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type {
  Activity,
  ActivityFilter,
  SessionSummary,
} from "@/types/activity";

async function getJson<T>(path: string): Promise<T> {
  const res = await apiFetch(path);
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status} ${res.statusText}`);
  }
  const json = await res.json();
  if (json.success === false) {
    throw new Error(json.error || "API returned unsuccessful response");
  }
  return json;
}

function toQueryString(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

// ─── Sources ────────────────────────────────────────────────────────────────

export interface SourceInstance {
  id: string;
  machine: string;
  endpoint: string | null;
  collectorKind: string;
  status: string;
  lastSeenAt: string | null;
  lastError: string | null;
  meta: unknown;
}

export interface Source {
  id: string;
  name: string;
  kind: string;
  defaultUnit: "quota" | "compute" | "usd";
  instances: SourceInstance[];
}

export function useSources(): UseQueryResult<Source[]> {
  return useQuery({
    queryKey: ["sources"],
    queryFn: async () =>
      (await getJson<{ sources: Source[] }>("/api/sources")).sources,
    refetchInterval: 30_000,
  });
}

// ─── Sessions ───────────────────────────────────────────────────────────────

export function useSessionList(opts: {
  sourceId?: string;
  limit?: number;
  offset?: number;
}): UseQueryResult<SessionSummary[]> {
  return useQuery({
    queryKey: ["sessions", opts],
    queryFn: async () =>
      (
        await getJson<{ sessions: SessionSummary[] }>(
          `/api/sessions${toQueryString(opts)}`,
        )
      ).sessions,
  });
}

export function useSession(
  id: string | undefined,
): UseQueryResult<SessionSummary & { activities: Activity[] }> {
  return useQuery({
    queryKey: ["session", id],
    queryFn: async () =>
      (
        await getJson<{ session: SessionSummary & { activities: Activity[] } }>(
          `/api/sessions/${id}`,
        )
      ).session,
    enabled: !!id,
  });
}

// ─── Activities ─────────────────────────────────────────────────────────────

export function useActivityList(
  filter: Partial<ActivityFilter>,
): UseQueryResult<Activity[]> {
  return useQuery({
    queryKey: ["activities", filter],
    queryFn: async () =>
      (
        await getJson<{ activities: Activity[] }>(
          `/api/activities${toQueryString(filter as Record<string, string | number | undefined>)}`,
        )
      ).activities,
  });
}

export function useActivity(id: string | undefined): UseQueryResult<Activity> {
  return useQuery({
    queryKey: ["activity", id],
    queryFn: async () =>
      (await getJson<{ activity: Activity }>(`/api/activities/${id}`)).activity,
    enabled: !!id,
  });
}

// ─── Consumption ────────────────────────────────────────────────────────────

/** Raw SQL passthrough — snake_case, unlike every other endpoint. */
export interface ConsumptionRow {
  day: string;
  source_id: string;
  model: string | null;
  unit: "quota" | "compute" | "usd";
  input_tokens: number;
  output_tokens: number;
  compute_seconds: number;
  cost_usd: number | null;
}

export function useConsumption(opts: {
  since?: string;
  sourceId?: string;
}): UseQueryResult<ConsumptionRow[]> {
  return useQuery({
    queryKey: ["consumption", opts],
    queryFn: async () =>
      (
        await getJson<{ consumption: ConsumptionRow[] }>(
          `/api/consumption${toQueryString(opts)}`,
        )
      ).consumption,
  });
}

// ─── Failures ───────────────────────────────────────────────────────────────

export interface FailureItem {
  kind: "activity" | "inference_request" | "runtime_event";
  id: string;
  sourceId: string;
  timestamp: string;
  summary: string;
  detail?: string;
}

export function useFailures(limit = 50): UseQueryResult<FailureItem[]> {
  return useQuery({
    queryKey: ["failures", limit],
    queryFn: async () =>
      (
        await getJson<{ failures: FailureItem[] }>(
          `/api/failures?limit=${limit}`,
        )
      ).failures,
  });
}

// ─── Jobs (repurposed Cron UI — read-only) ─────────────────────────────────

export interface JobState {
  lastRunAtMs?: number;
  lastRunStatus?: string;
  lastDurationMs?: number;
  lastError?: string;
  consecutiveErrors?: number;
}

export interface BackgroundJob {
  id: string;
  name: string;
  sourceId: string;
  kind: string;
  enabled: boolean;
  state: JobState;
}

export interface JobRun {
  id: string;
  jobId: string;
  timestamp: number;
  status: string;
  duration?: number;
  output?: string;
  error?: string;
}

export function useJobs(): UseQueryResult<BackgroundJob[]> {
  return useQuery({
    queryKey: ["jobs"],
    queryFn: async () =>
      (await getJson<{ jobs: BackgroundJob[] }>("/api/jobs")).jobs,
    refetchInterval: 30_000,
  });
}

export function useJob(id: string | undefined): UseQueryResult<BackgroundJob> {
  return useQuery({
    queryKey: ["job", id],
    queryFn: async () =>
      (await getJson<{ job: BackgroundJob }>(`/api/jobs/${id}`)).job,
    enabled: !!id,
  });
}

export function useJobRuns(
  id: string | undefined,
  limit = 20,
): UseQueryResult<JobRun[]> {
  return useQuery({
    queryKey: ["job-runs", id, limit],
    queryFn: async () =>
      (await getJson<{ runs: JobRun[] }>(`/api/jobs/${id}/runs?limit=${limit}`))
        .runs,
    enabled: !!id,
  });
}
