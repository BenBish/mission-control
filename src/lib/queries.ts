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

// ─── Provider API usage (billing connectors) ────────────────────────────────

export interface ProviderStatus {
  id: string;
  name: string;
  configured: boolean;
  envVars: string[];
  notes: string | null;
  status: string;
  lastSyncAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  limitation: string | null;
  cursorDay: string | null;
}

export interface ProviderBreakdownRow {
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number | null;
  request_count: number;
}

export function useProviderStatus(): UseQueryResult<ProviderStatus[]> {
  return useQuery({
    queryKey: ["provider-status"],
    queryFn: async () =>
      (await getJson<{ providers: ProviderStatus[] }>("/api/providers/status"))
        .providers,
    refetchInterval: 60_000,
  });
}

export function useProviderBreakdown(opts: {
  since?: string;
  provider?: string;
}): UseQueryResult<ProviderBreakdownRow[]> {
  return useQuery({
    queryKey: ["provider-breakdown", opts],
    queryFn: async () =>
      (
        await getJson<{ breakdown: ProviderBreakdownRow[] }>(
          `/api/providers/usage/breakdown${toQueryString(opts)}`,
        )
      ).breakdown,
  });
}

export async function triggerProviderSync(providers?: string[]): Promise<{
  results: Array<{ provider: string; status: string; rowsUpserted: number }>;
}> {
  const res = await apiFetch("/api/providers/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(providers ? { providers } : {}),
  });
  if (!res.ok) {
    throw new Error(`Sync failed: ${res.status} ${res.statusText}`);
  }
  const json = await res.json();
  if (json.success === false) {
    throw new Error(json.error || "Provider sync failed");
  }
  return json;
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

// ─── Runtime (Hermes telemetry) ────────────────────────────────────────────

export type RuntimeSnapshotKind = "slots" | "health" | "models";

export interface RuntimeSnapshot {
  sourceId: string;
  instanceId: string;
  timestamp: string;
  kind: RuntimeSnapshotKind;
  slotsTotal: number | null;
  slotsBusy: number | null;
  /** Only present on kind:'models' snapshots. */
  modelsLoaded:
    | {
        model: string;
        name: string;
        description?: string;
        proxy?: string;
        state?: string;
      }[]
    | null;
  healthy: boolean | null;
  /** kind:'slots' snapshots carry {port, label} here — the only way to
   *  tell one backend's occupancy from another's, since slotsTotal/Busy
   *  alone don't identify which backend they're for. */
  payload: { port?: number; label?: string } | null;
}

export interface InferenceRequestSummary {
  id: string;
  sourceId: string;
  instanceId: string;
  timestamp: string;
  model: string | null;
  clientLabel: string | null;
  workload: "foreground" | "background" | "unknown";
  promptTokens: number | null;
  completionTokens: number | null;
  ttftMs: number | null;
  durationMs: number | null;
  tokensPerSec: number | null;
  slotId: number | null;
  status: "success" | "cancelled" | "context_overflow" | "error";
  error: string | null;
}

export interface RuntimeEvent {
  id: string;
  sourceId: string;
  instanceId: string;
  timestamp: string;
  endedAt: string | null;
  kind:
    | "slots_saturated"
    | "model_load"
    | "model_unload"
    | "service_down"
    | "service_up"
    | "context_overflow"
    | "request_cancelled";
  severity: "info" | "warning" | "error";
  summary: string;
  details: unknown;
}

export interface RuntimeData {
  sources: Source[];
  snapshots: RuntimeSnapshot[];
  inferenceRequests: InferenceRequestSummary[];
  runtimeEvents: RuntimeEvent[];
}

export function useRuntime(limit = 50): UseQueryResult<RuntimeData> {
  return useQuery({
    queryKey: ["runtime", limit],
    queryFn: () => getJson<RuntimeData>(`/api/runtime?limit=${limit}`),
    refetchInterval: 5_000,
  });
}

// ─── Contention incidents (best-effort — see src/db/queries/contention.ts) ─

export interface ContentionIncident {
  id: string;
  instanceId: string;
  backgroundRequestId: string;
  backgroundClientLabel: string | null;
  backgroundModel: string | null;
  backgroundStartedAt: string;
  backgroundDurationMs: number | null;
  saturationEventId: string;
  saturationSummary: string;
  saturationStartedAt: string;
  saturationEndedAt: string;
  foregroundRequestId: string;
  foregroundStartedAt: string;
  foregroundTtftMs: number | null;
}

export function useContention(
  limit = 20,
): UseQueryResult<ContentionIncident[]> {
  return useQuery({
    queryKey: ["contention", limit],
    queryFn: async () =>
      (
        await getJson<{ incidents: ContentionIncident[] }>(
          `/api/contention?limit=${limit}`,
        )
      ).incidents,
    refetchInterval: 30_000,
  });
}

// ─── Generation jobs (ComfyUI) — src/db/queries/generation.ts ─────────────

export type GenerationJobStatus =
  | "queued"
  | "running"
  | "success"
  | "error"
  | "interrupted";

export interface GenerationJob {
  id: string;
  sourceId: string;
  instanceId: string;
  externalId: string;
  status: GenerationJobStatus;
  firstSeenAt: string;
  observedStartedAt: string | null;
  observedCompletedAt: string | null;
  workflowHash: string | null;
  nodeCount: number | null;
  outputCount: number | null;
  details: unknown;
}

export function useGenerations(limit = 50): UseQueryResult<GenerationJob[]> {
  return useQuery({
    queryKey: ["generations", limit],
    queryFn: async () =>
      (
        await getJson<{ jobs: GenerationJob[] }>(
          `/api/generations?limit=${limit}`,
        )
      ).jobs,
    refetchInterval: 15_000,
  });
}

export function useGeneration(
  id: string | undefined,
): UseQueryResult<GenerationJob> {
  return useQuery({
    queryKey: ["generation", id],
    queryFn: async () =>
      (await getJson<{ job: GenerationJob }>(`/api/generations/${id}`)).job,
    enabled: !!id,
  });
}
