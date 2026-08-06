/**
 * React Query hooks over the ingest API's read endpoints.
 *
 * Every hook mirrors its route's response envelope ({success, ...}) and
 * throws on non-2xx / success:false so react-query's error state just works.
 */

import {
  keepPreviousData,
  useQuery,
  type UseQueryResult,
} from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type {
  Activity,
  ActivityFilter,
  SessionSummary,
} from "@/types/activity";
import type {
  FailureGroup,
  FailureGroupEventsResponse,
  FailureGroupsResponse,
  FailureItem,
  FailureKind,
  FailureResolution,
  FailureSummary,
  FailuresResponse,
} from "@/types/failures";

export type {
  FailureGroup,
  FailureGroupEventsResponse,
  FailureGroupsResponse,
  FailureItem,
  FailureKind,
  FailureResolution,
  FailureSummary,
  FailuresResponse,
} from "@/types/failures";

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

// ─── Agent Usage (normalized dimensions + coverage, BSH-99) ─────────────────

export type AgentUsageDimension =
  | "model"
  | "project"
  | "actor"
  | "source"
  | "session";

export type AgentUsageDriver = {
  key: string;
  sourceId: string;
  canonicalModel: string;
  rawModels: string[];
  project: string | null;
  sessionId: string | null;
  sessionTitle: string | null;
  actorId: string | null;
  actorType: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number | null;
  hasCost: boolean;
  requestCount: number;
  sessionCount: number;
  materiality: "material" | "zero" | "synthetic";
  attribution: "known" | "unknown";
};

export type AgentUsageSummary = {
  success: boolean;
  source: string;
  range: { since: string | null; until: string | null };
  dimension: AgentUsageDimension;
  includeNonMaterial: boolean;
  totals: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    costUsd: number | null;
    hasCost: boolean;
    requestCount: number;
    sessionCount: number;
  };
  coverage: {
    totalTokens: number;
    materialTokens: number;
    unattributedTokens: number;
    unattributedPct: number;
    syntheticTokens: number;
    zeroTokenFactCount: number;
    unknownModelTokens: number;
    missingProjectTokens: number;
  };
  drivers: AgentUsageDriver[];
};

export type AgentUsageSessionRow = {
  sessionId: string;
  sourceId: string;
  externalId: string | null;
  title: string | null;
  project: string | null;
  startedAt: string | null;
  canonicalModel: string;
  rawModels: string[];
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number | null;
  hasCost: boolean;
  requestCount: number;
};

export function useAgentUsage(opts: {
  since?: string;
  until?: string;
  sourceId?: string;
  dimension?: AgentUsageDimension;
  includeNonMaterial?: boolean;
}): UseQueryResult<AgentUsageSummary> {
  const {
    since,
    until,
    sourceId,
    dimension = "model",
    includeNonMaterial = false,
  } = opts;
  return useQuery({
    queryKey: [
      "agent-usage",
      { since, until, sourceId, dimension, includeNonMaterial },
    ],
    queryFn: async () =>
      getJson<AgentUsageSummary>(
        `/api/consumption/agent-usage${toQueryString({
          since,
          until,
          sourceId,
          dimension,
          includeNonMaterial: includeNonMaterial ? "1" : undefined,
        })}`,
      ),
  });
}

export function useAgentUsageSessions(opts: {
  since?: string;
  until?: string;
  sourceId?: string;
  dimension: AgentUsageDimension;
  driverKey: string | null;
  enabled?: boolean;
}): UseQueryResult<{ sessions: AgentUsageSessionRow[] }> {
  const { since, until, sourceId, dimension, driverKey, enabled = true } = opts;
  return useQuery({
    queryKey: [
      "agent-usage-sessions",
      { since, until, sourceId, dimension, driverKey },
    ],
    enabled: enabled && !!driverKey,
    queryFn: async () =>
      getJson<{ sessions: AgentUsageSessionRow[] }>(
        `/api/consumption/agent-usage/sessions${toQueryString({
          since,
          until,
          sourceId,
          dimension,
          driverKey: driverKey ?? undefined,
        })}`,
      ),
  });
}

// ─── Spend reconciliation (BSH-101) ─────────────────────────────────────────

export type ByokTreatment =
  | "flag_overlap"
  | "exclude_openrouter"
  | "prefer_direct";

export type MatchClassification =
  | "exact"
  | "likely"
  | "ambiguous"
  | "duplicate_risk"
  | "unmatched_provider"
  | "unmatched_agent";

export type ReconciliationMatch = {
  key: string;
  day: string;
  canonicalModel: string;
  classification: MatchClassification;
  ruleHit: string;
  confidence: number;
  tokenRatio: number | null;
  provider: Array<{
    provider: string;
    rawModels: string[];
    inputTokens: number;
    outputTokens: number;
    costUsd: number | null;
    requestCount: number;
    updatedAt: string | null;
  }>;
  agent: {
    sourceIds: string[];
    rawModels: string[];
    inputTokens: number;
    outputTokens: number;
    logCostUsd: number | null;
    hasLogCost: boolean;
    requestCount: number;
  } | null;
  providerCostUsd: number;
  isMatched: boolean;
};

export type SpendReconciliation = {
  success: boolean;
  source: string;
  range: { since: string | null; until: string | null };
  options: {
    includeProviders: string[] | null;
    excludeProviders: string[];
    byokTreatment: ByokTreatment;
  };
  summary: {
    providerSpendUsd: number;
    matchedSpendUsd: number;
    unmatchedProviderSpendUsd: number;
    ambiguousSpendUsd: number;
    duplicateRiskSpendUsd: number;
    agentTokensWithoutBilling: number;
    agentLogCostUsd: number | null;
    hasAgentLogCost: boolean;
    coveragePct: number | null;
    matchCounts: Record<MatchClassification, number>;
  };
  matches: ReconciliationMatch[];
  notes: string[];
  meta: {
    source: string;
    documentation: string;
    exactTokenRatio: number;
    computedAt: string;
  };
};

export function useSpendReconciliation(opts: {
  since?: string;
  until?: string;
  sourceId?: string;
  providers?: string[] | null;
  excludeProviders?: string[];
  byok?: ByokTreatment;
  enabled?: boolean;
}): UseQueryResult<SpendReconciliation> {
  const {
    since,
    until,
    sourceId,
    providers,
    excludeProviders,
    byok = "flag_overlap",
    enabled = true,
  } = opts;
  return useQuery({
    queryKey: [
      "spend-reconciliation",
      { since, until, sourceId, providers, excludeProviders, byok },
    ],
    enabled,
    queryFn: async () =>
      getJson<SpendReconciliation>(
        `/api/consumption/reconciliation${toQueryString({
          since,
          until,
          sourceId,
          providers: providers?.length ? providers.join(",") : undefined,
          excludeProviders: excludeProviders?.length
            ? excludeProviders.join(",")
            : undefined,
          byok,
        })}`,
      ),
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

/**
 * Default retry for provider billing queries.
 * Fail-fast keeps the homepage spend card from lingering on "…"; override via
 * hook options when a caller wants more resilient retries (e.g. background sync).
 */
export const PROVIDER_QUERY_DEFAULT_RETRY = 1;

export function useProviderStatus(opts?: {
  /** React Query retry count/boolean. Default: PROVIDER_QUERY_DEFAULT_RETRY. */
  retry?: number | boolean;
}): UseQueryResult<ProviderStatus[]> {
  return useQuery({
    queryKey: ["provider-status"],
    queryFn: async () =>
      (await getJson<{ providers: ProviderStatus[] }>("/api/providers/status"))
        .providers,
    refetchInterval: 60_000,
    retry: opts?.retry ?? PROVIDER_QUERY_DEFAULT_RETRY,
  });
}

export function useProviderBreakdown(opts: {
  since?: string;
  provider?: string;
  /** React Query retry count/boolean. Default: PROVIDER_QUERY_DEFAULT_RETRY. */
  retry?: number | boolean;
}): UseQueryResult<ProviderBreakdownRow[]> {
  const { since, provider, retry } = opts;
  return useQuery({
    // Keep since/provider only in the key — retry is not part of cache identity.
    queryKey: ["provider-breakdown", { since, provider }],
    queryFn: async () =>
      (
        await getJson<{ breakdown: ProviderBreakdownRow[] }>(
          `/api/providers/usage/breakdown${toQueryString({ since, provider })}`,
        )
      ).breakdown,
    retry: retry ?? PROVIDER_QUERY_DEFAULT_RETRY,
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

// ─── Provider budget & spend insights ───────────────────────────────────────

export interface ProviderBudgetConfig {
  monthlyBudgetUsd: number | null;
  timezone: string;
}

export interface SpendInsightsDailyPoint {
  day: string;
  costUsd: number;
  priorPeriodCostUsd: number | null;
  deltaUsd: number | null;
  deltaPct: number | null;
}

export interface SpendInsightsBreakdownRow {
  provider: string;
  model: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  priorPeriodCostUsd: number;
  deltaUsd: number;
  deltaPct: number | null;
}

export interface SpendAnomaly {
  kind: "daily" | "provider_model";
  day: string;
  provider: string | null;
  model: string | null;
  valueUsd: number;
  baselineUsd: number;
  ratio: number;
  message: string;
}

export interface SpendSyncWarning {
  provider: string;
  status: string;
  reason: "error" | "stale" | "not_configured" | "limited" | "no_sync_data";
  lastSuccessAt: string | null;
  lastError: string | null;
}

export type ForecastMethod = "simple_mtd" | "trailing_7d" | "weighted_recency";

export interface ForecastDetail {
  method: ForecastMethod;
  pointUsd: number;
  lowUsd: number;
  highUsd: number;
  confidence: number;
  daysUsed: number;
  daysElapsed: number;
  daysInMonth: number;
  incompleteDays: string[];
  incompleteDayTreatment: "excluded_from_burn" | "included_labeled";
  billingLagDays: number;
  windowStart: string;
  windowEnd: string;
  notes: string[];
}

export interface ScopedBudgetProgress {
  id: string;
  scopeType: "account" | "provider" | "model" | "project";
  scopeKey: string;
  monthlyBudgetUsd: number;
  consumedUsd: number;
  remainingUsd: number;
  consumedPct: number;
  warnThresholdPct: number;
  criticalThresholdPct: number;
  status: "ok" | "warn" | "critical";
  enabled: boolean;
}

export interface EfficiencySlice {
  dimension: "provider" | "model" | "project" | "overall";
  key: string;
  costClass: "actual_provider" | "agent_attributed" | "estimated";
  costUsd: number | null;
  requestCount: number;
  sessionCount: number;
  successfulSessionCount: number | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costPerRequest: number | null;
  costPerSession: number | null;
  costPerSuccessfulSession: number | null;
  costPer1MOutputTokens: number | null;
  cacheSavingsUsd: number | null;
  failureWasteUsd: number | null;
  missingOutcomeAttributionPct: number | null;
  notes: string[];
}

export interface OptimizationRecommendation {
  kind:
    | "expensive_outlier"
    | "cheaper_model"
    | "cache_opportunity"
    | "failure_waste"
    | "local_vs_api";
  title: string;
  message: string;
  estimatedImpactUsd: number;
  costClass: "actual_provider" | "agent_attributed" | "estimated";
  evidence: Record<string, unknown>;
  hrefHint: string;
}

export interface FeeCategoryBreakdown {
  actualProviderSpendUsd: number;
  agentAttributedCostUsd: number | null;
  estimatedCacheSavingsUsd: number | null;
  failureWasteUsd: number | null;
  notes: string[];
}

export interface SpendAlert {
  id: string;
  kind: "threshold" | "anomaly";
  severity: "info" | "warn" | "critical";
  scopeType: string | null;
  scopeKey: string | null;
  title: string;
  message: string;
  evidence: Record<string, unknown> | null;
  estimatedImpactUsd: number | null;
  deliveryState:
    | "pending"
    | "delivered"
    | "acknowledged"
    | "suppressed"
    | "failed";
  deliveredAt: string | null;
  acknowledgedAt: string | null;
  fingerprint: string;
  monthKey: string;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface SpendBudget {
  id: string;
  scopeType: "account" | "provider" | "model" | "project";
  scopeKey: string;
  monthlyBudgetUsd: number;
  warnThresholdPct: number;
  criticalThresholdPct: number;
  enabled: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface SpendInsights {
  budget: {
    monthlyBudgetUsd: number | null;
    consumedUsd: number;
    remainingUsd: number | null;
    consumedPct: number | null;
  };
  scopedBudgets: ScopedBudgetProgress[];
  burnRateUsdPerDay: number;
  forecastMonthEndUsd: number;
  forecast: ForecastDetail;
  dailyTrend: SpendInsightsDailyPoint[];
  topBreakdown: SpendInsightsBreakdownRow[];
  anomalies: SpendAnomaly[];
  syncWarnings: SpendSyncWarning[];
  efficiency: {
    provider: EfficiencySlice[];
    agent: EfficiencySlice[];
  };
  feeCategories: FeeCategoryBreakdown;
  recommendations: OptimizationRecommendation[];
  alerts: SpendAlert[];
  meta: {
    source: "provider-api";
    timezone: string;
    monthStart: string;
    monthEnd: string;
    today: string;
    daysElapsed: number;
    daysInMonth: number;
    partialMonth: boolean;
    forecastReliable: boolean;
    billingLagDays: number;
    incompleteDays: string[];
    forecastMethod: ForecastMethod;
    notes: string[];
  };
}

export function useProviderBudget(): UseQueryResult<ProviderBudgetConfig> {
  return useQuery({
    queryKey: ["provider-budget"],
    queryFn: async () =>
      (await getJson<{ budget: ProviderBudgetConfig }>("/api/providers/budget"))
        .budget,
  });
}

export async function updateProviderBudget(body: {
  monthlyBudgetUsd?: number | null;
  timezone?: string;
}): Promise<ProviderBudgetConfig> {
  const res = await apiFetch("/api/providers/budget", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok || json.success === false) {
    throw new Error(json.error || `Budget update failed: ${res.status}`);
  }
  return json.budget as ProviderBudgetConfig;
}

export function useScopedSpendBudgets(): UseQueryResult<SpendBudget[]> {
  return useQuery({
    queryKey: ["provider-scoped-budgets"],
    queryFn: async () =>
      (await getJson<{ budgets: SpendBudget[] }>("/api/providers/budgets"))
        .budgets,
  });
}

export async function upsertScopedSpendBudget(body: {
  id?: string;
  scopeType: SpendBudget["scopeType"];
  scopeKey: string;
  monthlyBudgetUsd: number;
  warnThresholdPct?: number;
  criticalThresholdPct?: number;
  enabled?: boolean;
}): Promise<SpendBudget> {
  const res = await apiFetch("/api/providers/budgets", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok || json.success === false) {
    throw new Error(json.error || `Scoped budget save failed: ${res.status}`);
  }
  return json.budget as SpendBudget;
}

export async function deleteScopedSpendBudget(id: string): Promise<void> {
  const res = await apiFetch(
    `/api/providers/budgets/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
    },
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    throw new Error(json.error || `Scoped budget delete failed: ${res.status}`);
  }
}

export async function acknowledgeSpendAlert(id: string): Promise<SpendAlert> {
  const res = await apiFetch(
    `/api/providers/spend-alerts/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deliveryState: "acknowledged" }),
    },
  );
  const json = await res.json();
  if (!res.ok || json.success === false) {
    throw new Error(json.error || `Alert update failed: ${res.status}`);
  }
  return json.alert as SpendAlert;
}

export function useProviderSpendInsights(): UseQueryResult<SpendInsights> {
  return useQuery({
    queryKey: ["provider-spend-insights"],
    queryFn: async () => {
      const body = await getJson<SpendInsights & { success?: boolean }>(
        "/api/providers/spend-insights",
      );
      return {
        budget: body.budget,
        scopedBudgets: body.scopedBudgets ?? [],
        burnRateUsdPerDay: body.burnRateUsdPerDay,
        forecastMonthEndUsd: body.forecastMonthEndUsd,
        forecast: body.forecast,
        dailyTrend: body.dailyTrend,
        topBreakdown: body.topBreakdown,
        anomalies: body.anomalies,
        syncWarnings: body.syncWarnings,
        efficiency: body.efficiency ?? { provider: [], agent: [] },
        feeCategories: body.feeCategories,
        recommendations: body.recommendations ?? [],
        alerts: body.alerts ?? [],
        meta: body.meta,
      };
    },
    refetchInterval: 60_000,
  });
}

// ─── Provider credits / remaining capacity ──────────────────────────────────

export interface ProviderCredit {
  provider: string;
  asOf: string;
  remaining: number | null;
  total: number | null;
  unit: string;
  label: string;
  source: string;
  status: string;
  /** plan_usage | wallet — never API org spend (BSH-93) */
  surface: "plan_usage" | "wallet";
  details: Record<string, unknown> | null;
  updatedAt: string | null;
}

export interface ProviderCapacity {
  planUsage: ProviderCredit[];
  wallet: ProviderCredit[];
  /** Flat list for backward compatibility */
  credits: ProviderCredit[];
}

export function useProviderCredits(opts?: {
  provider?: string;
}): UseQueryResult<ProviderCapacity> {
  const provider = opts?.provider;
  return useQuery({
    queryKey: ["provider-credits", { provider }],
    queryFn: async () => {
      const body = await getJson<{
        credits: ProviderCredit[];
        planUsage?: ProviderCredit[];
        wallet?: ProviderCredit[];
      }>(`/api/providers/credits${toQueryString({ provider })}`);
      const credits = body.credits ?? [];
      return {
        credits,
        planUsage:
          body.planUsage ?? credits.filter((c) => c.surface === "plan_usage"),
        wallet: body.wallet ?? credits.filter((c) => c.surface === "wallet"),
      };
    },
    refetchInterval: 60_000,
  });
}

// ─── Failures ───────────────────────────────────────────────────────────────

export function useFailures(
  opts: {
    limit?: number;
    sourceId?: string;
  } = {},
): UseQueryResult<FailuresResponse> {
  const limit = opts.limit ?? 50;
  return useQuery({
    queryKey: ["failures", { limit, sourceId: opts.sourceId }],
    queryFn: async () => {
      const body = await getJson<{
        failures?: FailureItem[];
        summary?: FailureSummary;
      }>(`/api/failures${toQueryString({ limit, sourceId: opts.sourceId })}`);
      if (!body.summary) {
        throw new Error("Failures API response missing summary aggregates");
      }
      return {
        failures: body.failures ?? [],
        summary: body.summary,
      };
    },
  });
}

export function useFailureGroups(
  opts: {
    limit?: number;
    offset?: number;
    sourceId?: string;
    kind?: FailureKind | "";
    resolved?: FailureResolution | "";
  } = {},
): UseQueryResult<FailureGroupsResponse> {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  const kind = opts.kind || undefined;
  const resolved = opts.resolved || undefined;
  return useQuery({
    queryKey: [
      "failures",
      "groups",
      {
        limit,
        offset,
        sourceId: opts.sourceId,
        kind,
        resolved,
      },
    ],
    queryFn: async () => {
      const body = await getJson<{
        groups?: FailureGroup[];
        groupTotal?: number;
        summary?: FailureSummary;
      }>(
        `/api/failures/groups${toQueryString({
          limit,
          offset,
          sourceId: opts.sourceId,
          kind,
          resolved,
        })}`,
      );
      if (!body.summary) {
        throw new Error(
          "Failure groups API response missing summary aggregates",
        );
      }
      return {
        groups: body.groups ?? [],
        groupTotal: body.groupTotal ?? 0,
        summary: body.summary,
      };
    },
  });
}

export function useFailureGroupEvents(
  fingerprint: string | undefined,
  opts: {
    limit?: number;
    offset?: number;
    sourceId?: string;
    enabled?: boolean;
  } = {},
): UseQueryResult<FailureGroupEventsResponse> {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  return useQuery({
    queryKey: [
      "failures",
      "group-events",
      fingerprint,
      { limit, offset, sourceId: opts.sourceId },
    ],
    enabled: Boolean(fingerprint) && (opts.enabled ?? true),
    queryFn: async () => {
      const encoded = encodeURIComponent(fingerprint!);
      const body = await getJson<{
        fingerprint?: string;
        events?: FailureItem[];
        total?: number;
      }>(
        `/api/failures/groups/${encoded}/events${toQueryString({
          limit,
          offset,
          sourceId: opts.sourceId,
        })}`,
      );
      return {
        fingerprint: body.fingerprint ?? fingerprint!,
        events: body.events ?? [],
        total: body.total ?? 0,
      };
    },
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

export function useJobs(
  opts: {
    sourceId?: string;
  } = {},
): UseQueryResult<BackgroundJob[]> {
  return useQuery({
    queryKey: ["jobs", opts],
    queryFn: async () =>
      (
        await getJson<{ jobs: BackgroundJob[] }>(
          `/api/jobs${toQueryString(opts)}`,
        )
      ).jobs,
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
  /** Omitted from list payloads (BSH-102); present only if API includes it. */
  details?: unknown;
}

export type RuntimeRange = "1h" | "6h" | "24h" | "7d" | "all";

export type RuntimeSection = "summary" | "lists" | "all";

export interface RuntimeMetrics {
  activeSlots: number;
  totalSlots: number;
  saturationRate: number | null;
  requestThroughputPerHour: number | null;
  cancellationRate: number | null;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  requestCount: number;
  since: string | null;
  windowHours: number | null;
}

export interface RuntimePage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface RuntimeClientVolume {
  clientLabel: string;
  requestCount: number;
  promptTokens: number;
  completionTokens: number;
}

/** Summary section: metrics, health, slots — loads first for time-to-content. */
export interface RuntimeSummaryData {
  range: RuntimeRange;
  section?: RuntimeSection;
  sources: Source[];
  snapshots: RuntimeSnapshot[];
  metrics: RuntimeMetrics;
  filters: {
    clientLabels: string[];
    requestStatuses: string[];
    eventKinds: string[];
  };
  /** Request volume by client_label for the selected range (BSH-89). */
  requestsByClient?: RuntimeClientVolume[];
}

/** Lists section: paginated requests + events (deferred after summary). */
export interface RuntimeListsData {
  range: RuntimeRange;
  section?: RuntimeSection;
  inferenceRequests: RuntimePage<InferenceRequestSummary>;
  runtimeEvents: RuntimePage<RuntimeEvent>;
}

/** Combined (section=all) response — backward compatible. */
export interface RuntimeData extends RuntimeSummaryData, RuntimeListsData {}

export interface RuntimeQueryParams {
  range?: RuntimeRange;
  section?: RuntimeSection;
  sourceId?: string;
  reqStatus?: string;
  reqClient?: string;
  /** Minimum duration_ms for slow-request triage. */
  reqMinDurationMs?: number;
  reqPage?: number;
  reqLimit?: number;
  eventKind?: string;
  eventPage?: number;
  eventLimit?: number;
}

function buildRuntimeQuery(params: RuntimeQueryParams = {}): string {
  const sp = new URLSearchParams();
  if (params.range) sp.set("range", params.range);
  if (params.section) sp.set("section", params.section);
  if (params.sourceId) sp.set("sourceId", params.sourceId);
  if (params.reqStatus) sp.set("reqStatus", params.reqStatus);
  if (params.reqClient) sp.set("reqClient", params.reqClient);
  if (params.reqMinDurationMs != null)
    sp.set("reqMinDurationMs", String(params.reqMinDurationMs));
  if (params.reqPage != null) sp.set("reqPage", String(params.reqPage));
  if (params.reqLimit != null) sp.set("reqLimit", String(params.reqLimit));
  if (params.eventKind) sp.set("eventKind", params.eventKind);
  if (params.eventPage != null) sp.set("eventPage", String(params.eventPage));
  if (params.eventLimit != null)
    sp.set("eventLimit", String(params.eventLimit));
  const qs = sp.toString();
  return qs ? `/api/runtime?${qs}` : "/api/runtime";
}

/** @deprecated Prefer useRuntimeSummary + useRuntimeLists for progressive load. */
export function useRuntime(
  params: RuntimeQueryParams = {},
): UseQueryResult<RuntimeData> {
  return useQuery({
    queryKey: ["runtime", "all", params],
    queryFn: () =>
      getJson<RuntimeData>(
        buildRuntimeQuery({ ...params, section: params.section ?? "all" }),
      ),
    refetchInterval: 5_000,
    placeholderData: keepPreviousData,
  });
}

/** Fleet metrics + slot/source state — first paint for Runtime (BSH-102). */
export function useRuntimeSummary(
  params: Pick<RuntimeQueryParams, "range" | "sourceId"> = {},
): UseQueryResult<RuntimeSummaryData> {
  return useQuery({
    queryKey: ["runtime", "summary", params],
    queryFn: () =>
      getJson<RuntimeSummaryData>(
        buildRuntimeQuery({ ...params, section: "summary" }),
      ),
    refetchInterval: 5_000,
    placeholderData: keepPreviousData,
  });
}

/** Paginated requests/events — deferred after summary (BSH-102). */
export function useRuntimeLists(
  params: RuntimeQueryParams = {},
): UseQueryResult<RuntimeListsData> {
  return useQuery({
    queryKey: ["runtime", "lists", params],
    queryFn: () =>
      getJson<RuntimeListsData>(
        buildRuntimeQuery({ ...params, section: "lists" }),
      ),
    refetchInterval: 5_000,
    placeholderData: keepPreviousData,
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

export function useGenerations(
  opts: {
    limit?: number;
    sourceId?: string;
  } = {},
): UseQueryResult<GenerationJob[]> {
  const limit = opts.limit ?? 50;
  return useQuery({
    queryKey: ["generations", { limit, sourceId: opts.sourceId }],
    queryFn: async () =>
      (
        await getJson<{ jobs: GenerationJob[] }>(
          `/api/generations${toQueryString({ limit, sourceId: opts.sourceId })}`,
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
