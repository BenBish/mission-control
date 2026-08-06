import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/_shared/PageHeader";
import { Loading } from "@/components/_shared/Loading";
import {
  DollarSign,
  Zap,
  Cpu,
  Calendar,
  RefreshCw,
  Cloud,
  Bot,
  Info,
  AlertTriangle,
  TrendingUp,
  Target,
  ChevronDown,
  Link2,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { useSourceFilter } from "@/app/source-context";
import {
  useAgentUsage,
  useAgentUsageSessions,
  useConsumption,
  useProviderBreakdown,
  useProviderStatus,
  useProviderSpendInsights,
  useProviderCredits,
  useSpendReconciliation,
  triggerProviderSync,
  acknowledgeSpendAlert,
  type AgentUsageDimension,
  type ByokTreatment,
  type MatchClassification,
  type ProviderCredit,
} from "@/lib/queries";
import {
  getAgentUsageSince,
  getProviderUsageSinceDay,
  type DatePreset,
} from "@/lib/date-range";

type Unit = "tokens" | "compute" | "usd";
type ConsumptionView = "agent" | "direct-api" | "attribution";

const PROVIDER_FILTER_OPTIONS = [
  "openrouter",
  "anthropic",
  "openai",
  "xai",
] as const;

const BYOK_OPTIONS: { label: string; value: ByokTreatment }[] = [
  { label: "Flag BYOK overlap", value: "flag_overlap" },
  { label: "Exclude OpenRouter", value: "exclude_openrouter" },
  { label: "Prefer direct providers", value: "prefer_direct" },
];

const AGENT_DIMENSIONS: { label: string; value: AgentUsageDimension }[] = [
  { label: "Model", value: "model" },
  { label: "Project", value: "project" },
  { label: "Actor", value: "actor" },
  { label: "Source", value: "source" },
  { label: "Session", value: "session" },
];

const DATE_PRESETS: { label: string; value: DatePreset }[] = [
  { label: "Today", value: "today" },
  { label: "Last 7 days", value: "7d" },
  { label: "Last 30 days", value: "30d" },
  { label: "All time", value: "all" },
];

const UNITS: { label: string; value: Unit }[] = [
  { label: "Tokens", value: "tokens" },
  { label: "Compute time", value: "compute" },
  { label: "USD", value: "usd" },
];

function parseView(raw: string | null): ConsumptionView {
  if (raw === "direct-api") return "direct-api";
  if (raw === "attribution") return "attribution";
  return "agent";
}

function classificationBadgeVariant(
  c: MatchClassification,
): "default" | "secondary" | "destructive" | "outline" {
  if (c === "exact" || c === "likely") return "default";
  if (c === "duplicate_risk" || c === "ambiguous") return "destructive";
  if (c === "unmatched_provider") return "secondary";
  return "outline";
}

function classificationLabel(c: MatchClassification): string {
  switch (c) {
    case "exact":
      return "Exact";
    case "likely":
      return "Likely";
    case "ambiguous":
      return "Ambiguous";
    case "duplicate_risk":
      return "Duplicate risk";
    case "unmatched_provider":
      return "Unmatched spend";
    case "unmatched_agent":
      return "Usage without cost";
  }
}

function parseRange(raw: string | null): DatePreset {
  if (raw === "today" || raw === "7d" || raw === "30d" || raw === "all") {
    return raw;
  }
  return "30d";
}

function parseUnit(raw: string | null): Unit {
  if (raw === "tokens" || raw === "compute" || raw === "usd") return raw;
  return "tokens";
}

function formatCompute(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${minutes.toFixed(1)}m`;
  return `${(minutes / 60).toFixed(1)}h`;
}

function statusBadgeVariant(
  status: string,
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "ok") return "default";
  if (status === "error") return "destructive";
  if (status === "limited" || status === "syncing") return "secondary";
  return "outline";
}

export default function Consumption() {
  const { selectedSourceId, sources } = useSourceFilter();
  const [searchParams, setSearchParams] = useSearchParams();
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [agentDimension, setAgentDimension] =
    useState<AgentUsageDimension>("model");
  const [includeNonMaterial, setIncludeNonMaterial] = useState(false);
  const [expandedDriverKey, setExpandedDriverKey] = useState<string | null>(
    null,
  );
  const [expandedMatchKey, setExpandedMatchKey] = useState<string | null>(null);
  const [byokTreatment, setByokTreatment] =
    useState<ByokTreatment>("flag_overlap");
  /** null = all providers included */
  const [includedProviders, setIncludedProviders] = useState<string[] | null>(
    null,
  );
  const queryClient = useQueryClient();
  const agentScope = selectedSourceId
    ? (sources.find((s) => s.id === selectedSourceId)?.name ?? selectedSourceId)
    : "all sources";

  const view = parseView(searchParams.get("view"));
  const datePreset = parseRange(searchParams.get("range"));
  const unit = parseUnit(searchParams.get("unit"));

  const updateParams = useCallback(
    (patch: { view?: ConsumptionView; range?: DatePreset; unit?: Unit }) => {
      // Push history when changing view so Back restores the previous tab;
      // range/unit/normalize updates replace to avoid cluttering history.
      const replace = patch.view === undefined;
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          const nextView = patch.view ?? parseView(prev.get("view"));
          const nextRange = patch.range ?? parseRange(prev.get("range"));
          const nextUnit = patch.unit ?? parseUnit(prev.get("unit"));

          // Always encode view + range so the URL is shareable and stable.
          next.set("view", nextView);
          next.set("range", nextRange);

          if (nextView === "agent") {
            next.set("unit", nextUnit);
          } else {
            // Unit only applies to Agent Usage.
            next.delete("unit");
          }
          return next;
        },
        { replace },
      );
    },
    [setSearchParams],
  );

  // Normalize missing/invalid query params so the URL always reflects selection.
  useEffect(() => {
    const rawView = searchParams.get("view");
    const rawRange = searchParams.get("range");
    const rawUnit = searchParams.get("unit");
    const viewOk =
      rawView === "agent" ||
      rawView === "direct-api" ||
      rawView === "attribution";
    const rangeOk =
      rawRange === "today" ||
      rawRange === "7d" ||
      rawRange === "30d" ||
      rawRange === "all";
    const unitOk =
      parseView(rawView) === "agent"
        ? rawUnit === "tokens" || rawUnit === "compute" || rawUnit === "usd"
        : rawUnit == null;
    if (!viewOk || !rangeOk || !unitOk) {
      updateParams({});
    }
  }, [searchParams, updateParams]);

  // Memoized on datePreset only — these helpers read the current time, so
  // calling them directly in the hook args would produce a new query key
  // on every render.
  // Agent usage: ISO timestamps. Provider usage: UTC day keys (YYYY-MM-DD).
  const agentSince = useMemo(
    () => getAgentUsageSince(datePreset),
    [datePreset],
  );
  const providerSince = useMemo(
    () => getProviderUsageSinceDay(datePreset),
    [datePreset],
  );

  const {
    data: agentUsage,
    isLoading,
    error,
  } = useAgentUsage({
    since: agentSince,
    sourceId: selectedSourceId,
    dimension: agentDimension,
    includeNonMaterial,
  });

  // Legacy daily rows still power the Compute unit card (inference duration).
  const { data: dailyRows } = useConsumption({
    since: agentSince,
    sourceId: selectedSourceId,
  });

  const { data: drillSessions, isLoading: drillLoading } =
    useAgentUsageSessions({
      since: agentSince,
      sourceId: selectedSourceId,
      dimension: agentDimension,
      driverKey: expandedDriverKey,
    });

  const { data: providerStatus } = useProviderStatus();
  const { data: providerBreakdown, isLoading: providerLoading } =
    useProviderBreakdown({ since: providerSince });
  const {
    data: spendInsights,
    isLoading: insightsLoading,
    error: insightsError,
  } = useProviderSpendInsights();
  const { data: providerCapacity, isLoading: creditsLoading } =
    useProviderCredits();
  const planUsageCredits = providerCapacity?.planUsage ?? [];
  const walletCredits = providerCapacity?.wallet ?? [];

  // Attribution uses provider day keys for since; agent side also filters by source.
  const {
    data: reconciliation,
    isLoading: reconLoading,
    error: reconError,
  } = useSpendReconciliation({
    since: providerSince,
    sourceId: selectedSourceId,
    providers: includedProviders,
    byok: byokTreatment,
    enabled: view === "attribution",
  });

  const drivers = agentUsage?.drivers ?? [];
  const coverage = agentUsage?.coverage;
  const totals = useMemo(() => {
    const t = agentUsage?.totals;
    const compute = (dailyRows ?? []).reduce(
      (sum, r) => sum + (r.compute_seconds ?? 0),
      0,
    );
    if (!t) {
      return { tokens: 0, compute, cost: 0, hasCost: false };
    }
    return {
      tokens: t.inputTokens + t.outputTokens,
      compute,
      cost: t.hasCost ? (t.costUsd ?? 0) : 0,
      hasCost: t.hasCost,
    };
  }, [agentUsage, dailyRows]);

  const providerTotals = useMemo(() => {
    if (!providerBreakdown) return { tokens: 0, cost: 0, hasCost: false };
    return providerBreakdown.reduce(
      (acc, row) => ({
        tokens: acc.tokens + row.input_tokens + row.output_tokens,
        cost: acc.cost + (row.cost_usd ?? 0),
        hasCost: acc.hasCost || row.cost_usd != null,
      }),
      { tokens: 0, cost: 0, hasCost: false },
    );
  }, [providerBreakdown]);

  async function handleProviderSync() {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const { results } = await triggerProviderSync();
      const summary = results
        .map((r) => `${r.provider}: ${r.status}`)
        .join(" · ");
      setSyncMessage(summary);
      await queryClient.invalidateQueries({ queryKey: ["provider-status"] });
      await queryClient.invalidateQueries({ queryKey: ["provider-breakdown"] });
      await queryClient.invalidateQueries({
        queryKey: ["provider-spend-insights"],
      });
      await queryClient.invalidateQueries({ queryKey: ["provider-credits"] });
      await queryClient.invalidateQueries({
        queryKey: ["spend-reconciliation"],
      });
    } catch (err) {
      setSyncMessage(
        err instanceof Error ? err.message : "Provider sync failed",
      );
    } finally {
      setSyncing(false);
    }
  }

  const rangeLabel =
    DATE_PRESETS.find((p) => p.value === datePreset)?.label ?? "Last 30 days";
  const pageDescription = `Agent session usage for ${agentScope}; Direct API Spend is account-wide; Attribution links them with confidence — never summed blindly`;

  if (isLoading && view === "agent") {
    return (
      <div className="space-y-6">
        <PageHeader title="Consumption" description={pageDescription} />
        <Loading />
      </div>
    );
  }

  if (error && view === "agent") {
    return (
      <div className="space-y-6">
        <PageHeader title="Consumption" description={pageDescription} />
        <Card className="border-destructive">
          <CardContent className="py-6">
            <p className="font-medium text-destructive">Error</p>
            <p className="text-sm text-muted-foreground">
              {error instanceof Error ? error.message : "Unknown error"}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Consumption" description={pageDescription} />

      <Tabs
        value={view}
        onValueChange={(v) => updateParams({ view: parseView(v) })}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 min-w-0">
          {/* Scrollable tab strip so three labels never widen the page at 390px */}
          <div className="min-w-0 max-w-full overflow-x-auto">
            <TabsList className="h-auto w-max max-w-none">
              <TabsTrigger value="agent" className="gap-1.5 shrink-0">
                <Bot className="h-4 w-4 shrink-0" />
                Agent Usage
              </TabsTrigger>
              <TabsTrigger value="direct-api" className="gap-1.5 shrink-0">
                <Cloud className="h-4 w-4 shrink-0" />
                Direct API Spend
              </TabsTrigger>
              <TabsTrigger
                value="attribution"
                className="gap-1.5 shrink-0"
                data-testid="attribution-tab"
              >
                <Link2 className="h-4 w-4 shrink-0" />
                Attribution
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="flex flex-wrap gap-2">
            {DATE_PRESETS.map((p) => (
              <Button
                key={p.value}
                variant={datePreset === p.value ? "default" : "outline"}
                size="sm"
                onClick={() => updateParams({ range: p.value })}
              >
                {p.label}
              </Button>
            ))}
          </div>
        </div>

        <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-3">
          <Calendar className="h-3.5 w-3.5" />
          Showing: {rangeLabel}
        </p>

        <TabsContent value="agent" className="space-y-4 mt-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p className="text-sm text-muted-foreground max-w-2xl">
              Session-derived usage from agent sources (Claude Code, Codex,
              Grok, Hermes, etc.) for {agentScope}. Honors the global source
              filter. Not the same as account-level provider billing.
            </p>
            <div className="flex gap-2">
              {UNITS.map((u) => (
                <Button
                  key={u.value}
                  variant={unit === u.value ? "default" : "outline"}
                  size="sm"
                  onClick={() => updateParams({ unit: u.value })}
                >
                  {u.label}
                </Button>
              ))}
            </div>
          </div>

          {unit === "usd" && !totals.hasCost ? (
            <Card>
              <CardContent className="py-12 text-center">
                <div className="flex flex-col items-center gap-2 max-w-md mx-auto">
                  <DollarSign className="h-12 w-12 text-muted-foreground/30" />
                  <p className="text-muted-foreground">
                    No billable agent usage in this range
                    {selectedSourceId ? ` for ${agentScope}` : ""}. Sources here
                    are subscription or local, or no{" "}
                    <code className="text-xs">cost_usd</code> was recorded in
                    session logs.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Provider account billing is under the{" "}
                    <button
                      type="button"
                      className="underline hover:text-foreground"
                      onClick={() => updateParams({ view: "direct-api" })}
                    >
                      Direct API Spend
                    </button>{" "}
                    view — it is a separate dataset.
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {unit === "tokens" && (
                  <Card className="overflow-hidden border-l-4 border-l-blue-500">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground">
                        Total Tokens
                      </CardTitle>
                      <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                        <Zap className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="text-3xl font-bold tracking-tight tabular-nums">
                        {totals.tokens.toLocaleString()}
                      </div>
                      {agentUsage?.totals && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {agentUsage.totals.sessionCount.toLocaleString()}{" "}
                          sessions ·{" "}
                          {agentUsage.totals.requestCount.toLocaleString()}{" "}
                          requests
                        </p>
                      )}
                    </CardContent>
                  </Card>
                )}
                {unit === "compute" && (
                  <Card className="overflow-hidden border-l-4 border-l-purple-500">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground">
                        Compute Time
                      </CardTitle>
                      <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30">
                        <Cpu className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="text-3xl font-bold tracking-tight tabular-nums">
                        {formatCompute(totals.compute)}
                      </div>
                    </CardContent>
                  </Card>
                )}
                {unit === "usd" && (
                  <Card className="overflow-hidden border-l-4 border-l-emerald-500">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground">
                        Cost
                      </CardTitle>
                      <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
                        <DollarSign className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="text-3xl font-bold tracking-tight tabular-nums">
                        {totals.hasCost ? `$${totals.cost.toFixed(4)}` : "—"}
                      </div>
                    </CardContent>
                  </Card>
                )}
                {unit === "tokens" && coverage && (
                  <>
                    <Card className="overflow-hidden border-l-4 border-l-amber-500">
                      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">
                          Unattributed
                        </CardTitle>
                        <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
                          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="text-3xl font-bold tracking-tight tabular-nums">
                          {coverage.unattributedPct}%
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {coverage.unattributedTokens.toLocaleString()} tokens
                          unknown/synthetic
                        </p>
                      </CardContent>
                    </Card>
                    <Card className="overflow-hidden border-l-4 border-l-slate-500">
                      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">
                          Cache read
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-3xl font-bold tracking-tight tabular-nums">
                          {(
                            agentUsage?.totals.cacheReadTokens ?? 0
                          ).toLocaleString()}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          write{" "}
                          {(
                            agentUsage?.totals.cacheWriteTokens ?? 0
                          ).toLocaleString()}
                        </p>
                      </CardContent>
                    </Card>
                  </>
                )}
              </div>

              {coverage && coverage.totalTokens > 0 && (
                <Card className="border-dashed">
                  <CardContent className="py-3 text-sm text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
                    <span>
                      Material ranked:{" "}
                      <strong className="text-foreground">
                        {coverage.materialTokens.toLocaleString()}
                      </strong>{" "}
                      tokens
                    </span>
                    <span>
                      Unknown model:{" "}
                      {coverage.unknownModelTokens.toLocaleString()}
                    </span>
                    <span>
                      Synthetic: {coverage.syntheticTokens.toLocaleString()}
                    </span>
                    <span>
                      Zero-token rows excluded: {coverage.zeroTokenFactCount}
                    </span>
                    <span>
                      Missing project:{" "}
                      {coverage.missingProjectTokens.toLocaleString()} tokens
                    </span>
                  </CardContent>
                </Card>
              )}

              {drivers.length > 0 || coverage ? (
                <Card className="shadow-sm">
                  <CardHeader className="pb-4 border-b space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <CardTitle className="text-lg">
                          Ranked drivers
                        </CardTitle>
                        <CardDescription>
                          Canonical model identities with raw aliases for
                          diagnostics
                          {selectedSourceId
                            ? ` · filtered to ${agentScope}`
                            : ""}
                          . Zero-token and synthetic rows are excluded by
                          default.
                        </CardDescription>
                      </div>
                      <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                        <input
                          type="checkbox"
                          className="rounded border-muted-foreground"
                          checked={includeNonMaterial}
                          onChange={(e) => {
                            setIncludeNonMaterial(e.target.checked);
                            setExpandedDriverKey(null);
                          }}
                        />
                        Show zero / synthetic
                      </label>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {AGENT_DIMENSIONS.map((d) => (
                        <Button
                          key={d.value}
                          variant={
                            agentDimension === d.value ? "default" : "outline"
                          }
                          size="sm"
                          onClick={() => {
                            setAgentDimension(d.value);
                            setExpandedDriverKey(null);
                          }}
                        >
                          {d.label}
                        </Button>
                      ))}
                    </div>
                  </CardHeader>
                  <CardContent className="pt-4 px-0">
                    {drivers.length === 0 ? (
                      <p className="px-4 pb-4 text-sm text-muted-foreground">
                        No material drivers for this grouping
                        {includeNonMaterial
                          ? ""
                          : " (try Show zero / synthetic)"}
                        .
                      </p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead>
                            <tr className="border-b bg-muted/50">
                              <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                Source
                              </th>
                              <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                {agentDimension === "model"
                                  ? "Model"
                                  : agentDimension === "project"
                                    ? "Project"
                                    : agentDimension === "actor"
                                      ? "Actor"
                                      : agentDimension === "session"
                                        ? "Session"
                                        : "Driver"}
                              </th>
                              {unit === "tokens" && (
                                <>
                                  <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                    Input
                                  </th>
                                  <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                    Output
                                  </th>
                                  <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                    Cache
                                  </th>
                                </>
                              )}
                              {unit === "usd" && (
                                <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                  Cost
                                </th>
                              )}
                              {unit === "compute" && (
                                <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                  Requests
                                </th>
                              )}
                              <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                Sessions
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {drivers.map((row) => {
                              const open = expandedDriverKey === row.key;
                              const label =
                                agentDimension === "model"
                                  ? row.canonicalModel
                                  : agentDimension === "project"
                                    ? (row.project ?? "unassigned")
                                    : agentDimension === "actor"
                                      ? (row.actorId ?? "—")
                                      : agentDimension === "session"
                                        ? (row.sessionTitle ??
                                          row.sessionId ??
                                          "—")
                                        : row.sourceId;
                              return (
                                <Fragment key={row.key}>
                                  <tr
                                    className="border-b last:border-0 hover:bg-muted/40 cursor-pointer"
                                    onClick={() =>
                                      setExpandedDriverKey(
                                        open ? null : row.key,
                                      )
                                    }
                                  >
                                    <td className="py-3 px-4 text-sm">
                                      <span className="font-medium">
                                        {row.sourceId}
                                      </span>
                                    </td>
                                    <td className="py-3 px-4 text-sm">
                                      <div className="font-mono text-xs">
                                        {label}
                                      </div>
                                      {agentDimension === "model" &&
                                        row.rawModels.length > 0 && (
                                          <div className="text-[11px] text-muted-foreground mt-0.5">
                                            raw: {row.rawModels.join(", ")}
                                          </div>
                                        )}
                                      {row.project &&
                                        agentDimension !== "project" && (
                                          <div className="text-[11px] text-muted-foreground">
                                            {row.project}
                                          </div>
                                        )}
                                    </td>
                                    {unit === "tokens" && (
                                      <>
                                        <td className="py-3 px-4 text-sm text-right tabular-nums">
                                          {row.inputTokens.toLocaleString()}
                                        </td>
                                        <td className="py-3 px-4 text-sm text-right tabular-nums">
                                          {row.outputTokens.toLocaleString()}
                                        </td>
                                        <td className="py-3 px-4 text-sm text-right tabular-nums text-muted-foreground">
                                          {(
                                            row.cacheReadTokens +
                                            row.cacheWriteTokens
                                          ).toLocaleString()}
                                        </td>
                                      </>
                                    )}
                                    {unit === "usd" && (
                                      <td className="py-3 px-4 text-sm text-right tabular-nums">
                                        {row.hasCost
                                          ? `$${(row.costUsd ?? 0).toFixed(4)}`
                                          : "—"}
                                      </td>
                                    )}
                                    {unit === "compute" && (
                                      <td className="py-3 px-4 text-sm text-right tabular-nums">
                                        {row.requestCount.toLocaleString()}
                                      </td>
                                    )}
                                    <td className="py-3 px-4 text-sm text-right tabular-nums">
                                      {row.sessionCount.toLocaleString()}
                                    </td>
                                  </tr>
                                  {open && (
                                    <tr className="bg-muted/30">
                                      <td
                                        colSpan={unit === "tokens" ? 6 : 4}
                                        className="px-4 py-3"
                                      >
                                        <p className="text-xs font-medium mb-2">
                                          Contributing sessions
                                        </p>
                                        {drillLoading ? (
                                          <p className="text-xs text-muted-foreground">
                                            Loading…
                                          </p>
                                        ) : (
                                          <div className="overflow-x-auto">
                                            <table className="w-full text-xs">
                                              <thead>
                                                <tr className="text-muted-foreground">
                                                  <th className="text-left py-1 pr-2">
                                                    Session
                                                  </th>
                                                  <th className="text-left py-1 pr-2">
                                                    Project
                                                  </th>
                                                  <th className="text-right py-1 pr-2">
                                                    Tokens
                                                  </th>
                                                  <th className="text-right py-1">
                                                    Requests
                                                  </th>
                                                </tr>
                                              </thead>
                                              <tbody>
                                                {(
                                                  drillSessions?.sessions ?? []
                                                ).map((s) => (
                                                  <tr key={s.sessionId}>
                                                    <td className="py-1 pr-2">
                                                      {s.sessionId.startsWith(
                                                        "inference:",
                                                      ) ? (
                                                        <span className="text-muted-foreground">
                                                          inference bucket
                                                        </span>
                                                      ) : (
                                                        <Link
                                                          to={`/sessions/${encodeURIComponent(s.sessionId)}`}
                                                          className="underline hover:text-foreground"
                                                          onClick={(e) =>
                                                            e.stopPropagation()
                                                          }
                                                        >
                                                          {s.title ??
                                                            s.externalId ??
                                                            s.sessionId}
                                                        </Link>
                                                      )}
                                                    </td>
                                                    <td className="py-1 pr-2 text-muted-foreground">
                                                      {s.project ?? "—"}
                                                    </td>
                                                    <td className="py-1 pr-2 text-right tabular-nums">
                                                      {(
                                                        s.inputTokens +
                                                        s.outputTokens
                                                      ).toLocaleString()}
                                                    </td>
                                                    <td className="py-1 text-right tabular-nums">
                                                      {s.requestCount.toLocaleString()}
                                                    </td>
                                                  </tr>
                                                ))}
                                                {(drillSessions?.sessions
                                                  ?.length ?? 0) === 0 && (
                                                  <tr>
                                                    <td
                                                      colSpan={4}
                                                      className="py-2 text-muted-foreground"
                                                    >
                                                      No sessions for this
                                                      driver.
                                                    </td>
                                                  </tr>
                                                )}
                                              </tbody>
                                            </table>
                                          </div>
                                        )}
                                      </td>
                                    </tr>
                                  )}
                                </Fragment>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardContent className="py-12 text-center">
                    <p className="text-muted-foreground">
                      No Agent Usage data for this range
                      {selectedSourceId ? ` and ${agentScope}` : ""} yet.
                    </p>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="direct-api" className="space-y-4 mt-4 min-w-0">
          {/* BSH-98: decision content first — Overview → Drivers → Attribution → Capacity */}
          <Card className="shadow-sm border-dashed min-w-0 overflow-hidden">
            <CardHeader className="pb-3 border-b">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1.5 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Cloud className="h-5 w-5 shrink-0" />
                      Direct API Spend
                    </CardTitle>
                    <Badge variant="secondary">Account-wide</Badge>
                  </div>
                  <CardDescription className="max-w-2xl">
                    <strong>API org spend</strong> from provider Admin billing
                    APIs — not agent session logs, plan usage windows, or wallet
                    balances. Budget/forecast: calendar month (
                    {spendInsights?.meta.timezone ?? "UTC"}).
                  </CardDescription>
                  {selectedSourceId && (
                    <p className="text-xs text-amber-700 dark:text-amber-400 flex items-start gap-1.5">
                      <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      Source filter “{agentScope}” does not apply here —
                      provider billing is account-wide and cannot be scoped to a
                      single agent source.
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" asChild>
                    <Link to="/settings?tab=budgets">Configure budget</Link>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleProviderSync()}
                    disabled={syncing}
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 mr-1.5 ${syncing ? "animate-spin" : ""}`}
                    />
                    {syncing ? "Syncing…" : "Sync now"}
                  </Button>
                </div>
              </div>
              {syncMessage && (
                <p className="text-xs text-muted-foreground mt-2 font-mono break-all">
                  {syncMessage}
                </p>
              )}
            </CardHeader>

            <CardContent className="pt-4 space-y-8 min-w-0">
              {/* ── Overview: spend risk first ─────────────────────────── */}
              <section
                className="space-y-3 min-w-0"
                data-testid="direct-api-overview"
                aria-labelledby="direct-api-overview-heading"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2
                    id="direct-api-overview-heading"
                    className="text-sm font-semibold tracking-wide text-muted-foreground uppercase"
                  >
                    Overview
                  </h2>
                  <span className="text-xs text-muted-foreground">
                    Month-to-date spend &amp; budget risk
                  </span>
                </div>

                {insightsLoading ? (
                  <Loading />
                ) : insightsError ? (
                  <Card className="border-destructive">
                    <CardContent className="py-4">
                      <p className="text-sm text-destructive">
                        {insightsError instanceof Error
                          ? insightsError.message
                          : "Failed to load spend insights"}
                      </p>
                    </CardContent>
                  </Card>
                ) : spendInsights ? (
                  <>
                    {spendInsights.syncWarnings.filter(
                      (w) =>
                        w.reason === "error" ||
                        w.reason === "stale" ||
                        w.reason === "no_sync_data",
                    ).length > 0 && (
                      <div
                        className="space-y-2"
                        data-testid="spend-risk-warnings"
                      >
                        {spendInsights.syncWarnings
                          .filter(
                            (w) =>
                              w.reason === "error" ||
                              w.reason === "stale" ||
                              w.reason === "no_sync_data",
                          )
                          .map((w) => (
                            <div
                              key={`${w.provider}-${w.reason}`}
                              className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-sm text-amber-900 dark:text-amber-200"
                            >
                              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                              <div className="min-w-0">
                                {w.reason === "no_sync_data" ? (
                                  <>
                                    <p className="font-medium">
                                      No usable provider sync history
                                    </p>
                                    <p className="text-xs opacity-90 mt-0.5">
                                      Forecast is unreliable until a provider
                                      sync succeeds. See Capacity &amp; data
                                      health for connector status.
                                    </p>
                                  </>
                                ) : (
                                  <>
                                    <p className="font-medium">
                                      {w.provider}: {w.reason}
                                      {w.status ? ` (${w.status})` : ""}
                                    </p>
                                    {w.lastError && (
                                      <p className="text-xs opacity-90 mt-0.5 break-words">
                                        {w.lastError}
                                      </p>
                                    )}
                                    {w.reason === "stale" && (
                                      <p className="text-xs opacity-90 mt-0.5">
                                        Last success:{" "}
                                        {w.lastSuccessAt
                                          ? new Date(
                                              w.lastSuccessAt,
                                            ).toLocaleString()
                                          : "never"}
                                        . Forecast marked unreliable.
                                      </p>
                                    )}
                                  </>
                                )}
                              </div>
                            </div>
                          ))}
                      </div>
                    )}

                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <Card className="overflow-hidden border-l-4 border-l-emerald-500 min-w-0">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                          <CardTitle className="text-sm font-medium text-muted-foreground">
                            MTD spent
                          </CardTitle>
                          <DollarSign className="h-4 w-4 text-emerald-600 shrink-0" />
                        </CardHeader>
                        <CardContent>
                          <div className="text-2xl font-bold tabular-nums">
                            ${spendInsights.budget.consumedUsd.toFixed(2)}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1 break-words">
                            {spendInsights.meta.monthStart} →{" "}
                            {spendInsights.meta.today} (
                            {spendInsights.meta.timezone})
                          </p>
                        </CardContent>
                      </Card>

                      <Card className="overflow-hidden border-l-4 border-l-blue-500 min-w-0">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                          <CardTitle className="text-sm font-medium text-muted-foreground">
                            Budget remaining
                          </CardTitle>
                          <Target className="h-4 w-4 text-blue-600 shrink-0" />
                        </CardHeader>
                        <CardContent>
                          {spendInsights.budget.monthlyBudgetUsd == null ? (
                            <>
                              <div className="text-2xl font-bold">—</div>
                              <p className="text-xs text-muted-foreground mt-1">
                                <Link
                                  to="/settings?tab=budgets"
                                  className="underline hover:text-foreground"
                                >
                                  Set a monthly budget
                                </Link>
                              </p>
                            </>
                          ) : (
                            <>
                              <div className="text-2xl font-bold tabular-nums">
                                $
                                {(
                                  spendInsights.budget.remainingUsd ?? 0
                                ).toFixed(2)}
                              </div>
                              <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${
                                    (spendInsights.budget.consumedPct ?? 0) >=
                                    100
                                      ? "bg-destructive"
                                      : (spendInsights.budget.consumedPct ??
                                            0) >= 80
                                        ? "bg-amber-500"
                                        : "bg-blue-500"
                                  }`}
                                  style={{
                                    width: `${Math.min(100, spendInsights.budget.consumedPct ?? 0)}%`,
                                  }}
                                />
                              </div>
                              <p className="text-xs text-muted-foreground mt-1">
                                {(
                                  spendInsights.budget.consumedPct ?? 0
                                ).toFixed(1)}
                                % of $
                                {spendInsights.budget.monthlyBudgetUsd.toFixed(
                                  2,
                                )}
                              </p>
                            </>
                          )}
                        </CardContent>
                      </Card>

                      <Card className="overflow-hidden border-l-4 border-l-purple-500 min-w-0">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                          <CardTitle className="text-sm font-medium text-muted-foreground">
                            Burn rate
                          </CardTitle>
                          <TrendingUp className="h-4 w-4 text-purple-600 shrink-0" />
                        </CardHeader>
                        <CardContent>
                          <div className="text-2xl font-bold tabular-nums">
                            ${spendInsights.burnRateUsdPerDay.toFixed(2)}
                            <span className="text-sm font-normal text-muted-foreground">
                              /day
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            Day {spendInsights.meta.daysElapsed} of{" "}
                            {spendInsights.meta.daysInMonth}
                          </p>
                        </CardContent>
                      </Card>

                      <Card
                        className={`overflow-hidden border-l-4 min-w-0 ${
                          spendInsights.meta.forecastReliable
                            ? "border-l-orange-500"
                            : "border-l-amber-500"
                        }`}
                      >
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                          <CardTitle className="text-sm font-medium text-muted-foreground">
                            Forecast month-end
                          </CardTitle>
                          {!spendInsights.meta.forecastReliable && (
                            <Badge variant="secondary" className="text-xs">
                              unreliable
                            </Badge>
                          )}
                        </CardHeader>
                        <CardContent>
                          <div
                            className={`text-2xl font-bold tabular-nums ${
                              !spendInsights.meta.forecastReliable
                                ? "text-muted-foreground"
                                : ""
                            }`}
                          >
                            $
                            {(
                              spendInsights.forecast?.pointUsd ??
                              spendInsights.forecastMonthEndUsd
                            ).toFixed(2)}
                          </div>
                          {spendInsights.forecast && (
                            <p className="text-xs text-muted-foreground mt-1 tabular-nums">
                              Range ${spendInsights.forecast.lowUsd.toFixed(2)}
                              –$
                              {spendInsights.forecast.highUsd.toFixed(2)} ·{" "}
                              {(
                                spendInsights.forecast.confidence * 100
                              ).toFixed(0)}
                              % conf
                            </p>
                          )}
                          <p className="text-xs text-muted-foreground mt-1">
                            {spendInsights.meta.forecastReliable
                              ? `${spendInsights.forecast?.method ?? spendInsights.meta.forecastMethod ?? "burn"} · lag ${spendInsights.meta.billingLagDays ?? spendInsights.forecast?.billingLagDays ?? 0}d`
                              : spendInsights.syncWarnings.some(
                                    (w) => w.reason === "no_sync_data",
                                  )
                                ? "No sync history — do not trust this figure"
                                : "Stale/failed sync — do not trust this figure"}
                          </p>
                          {spendInsights.forecast?.incompleteDays?.length ? (
                            <p className="text-[11px] text-muted-foreground mt-1 break-words">
                              Incomplete days excluded from burn:{" "}
                              {spendInsights.forecast.incompleteDays.join(", ")}
                            </p>
                          ) : null}
                        </CardContent>
                      </Card>
                    </div>

                    {/* Fee classes — never summed */}
                    {spendInsights.feeCategories && (
                      <Card
                        className="shadow-sm min-w-0"
                        data-testid="fee-categories"
                      >
                        <CardHeader className="pb-2">
                          <CardTitle className="text-base">
                            Cost classes (kept separate)
                          </CardTitle>
                          <CardDescription>
                            Actual provider billing, agent-attributed session
                            cost, and estimates are never summed together
                          </CardDescription>
                        </CardHeader>
                        <CardContent>
                          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                            <div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 px-3 py-2">
                              <p className="text-xs font-medium text-emerald-800 dark:text-emerald-300">
                                Actual provider spend
                              </p>
                              <p className="text-lg font-bold tabular-nums">
                                $
                                {spendInsights.feeCategories.actualProviderSpendUsd.toFixed(
                                  2,
                                )}
                              </p>
                            </div>
                            <div className="rounded-md border border-blue-500/40 bg-blue-500/5 px-3 py-2">
                              <p className="text-xs font-medium text-blue-800 dark:text-blue-300">
                                Agent-attributed
                              </p>
                              <p className="text-lg font-bold tabular-nums">
                                {spendInsights.feeCategories
                                  .agentAttributedCostUsd == null
                                  ? "—"
                                  : `$${spendInsights.feeCategories.agentAttributedCostUsd.toFixed(2)}`}
                              </p>
                            </div>
                            <div className="rounded-md border border-violet-500/40 bg-violet-500/5 px-3 py-2">
                              <p className="text-xs font-medium text-violet-800 dark:text-violet-300">
                                Est. cache savings
                              </p>
                              <p className="text-lg font-bold tabular-nums">
                                {spendInsights.feeCategories
                                  .estimatedCacheSavingsUsd == null
                                  ? "—"
                                  : `$${spendInsights.feeCategories.estimatedCacheSavingsUsd.toFixed(2)}`}
                              </p>
                              <p className="text-[11px] text-muted-foreground">
                                Estimated — not a credit
                              </p>
                            </div>
                            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2">
                              <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
                                Failure waste
                              </p>
                              <p className="text-lg font-bold tabular-nums">
                                {spendInsights.feeCategories.failureWasteUsd ==
                                null
                                  ? "—"
                                  : `$${spendInsights.feeCategories.failureWasteUsd.toFixed(2)}`}
                              </p>
                              <p className="text-[11px] text-muted-foreground">
                                Agent-attributed
                              </p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    )}
                  </>
                ) : null}
              </section>

              {/* ── Drivers: trend + movers ────────────────────────────── */}
              <section
                className="space-y-3 min-w-0"
                data-testid="direct-api-drivers"
                aria-labelledby="direct-api-drivers-heading"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2
                    id="direct-api-drivers-heading"
                    className="text-sm font-semibold tracking-wide text-muted-foreground uppercase"
                  >
                    Drivers
                  </h2>
                  <span className="text-xs text-muted-foreground">
                    Trend, anomalies, top movers
                  </span>
                </div>

                {insightsLoading ? (
                  <Loading />
                ) : spendInsights ? (
                  <>
                    <Card className="shadow-sm min-w-0 overflow-hidden">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base">
                          Daily spend (MTD)
                        </CardTitle>
                        <CardDescription>
                          Current month vs same day-of-month in the prior month
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="min-w-0">
                        {spendInsights.dailyTrend.length === 0 ? (
                          <p className="text-sm text-muted-foreground py-8 text-center">
                            No daily spend yet this month.
                          </p>
                        ) : (
                          <DailySpendTrendChart
                            points={spendInsights.dailyTrend}
                          />
                        )}
                      </CardContent>
                    </Card>

                    {spendInsights.anomalies.length > 0 && (
                      <Card className="shadow-sm border-amber-500/40 min-w-0">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-base flex items-center gap-2">
                            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                            Spend anomalies
                          </CardTitle>
                          <CardDescription>
                            ≥2× rolling 7-day baseline and ≥$1
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-2">
                          {spendInsights.anomalies.slice(0, 10).map((a, i) => (
                            <div
                              key={`${a.kind}-${a.day}-${a.provider}-${a.model}-${i}`}
                              className="rounded-md border px-3 py-2 text-sm min-w-0"
                            >
                              <p className="font-medium break-words">
                                {a.message}
                              </p>
                              <p className="text-xs text-muted-foreground mt-0.5 tabular-nums break-words">
                                Value ${a.valueUsd.toFixed(4)} · baseline $
                                {a.baselineUsd.toFixed(4)}
                                {Number.isFinite(a.ratio)
                                  ? ` · ${a.ratio.toFixed(1)}×`
                                  : ""}
                                {a.provider && a.model
                                  ? ` · ${a.provider}/${a.model}`
                                  : ""}
                              </p>
                            </div>
                          ))}
                        </CardContent>
                      </Card>
                    )}

                    <Card className="shadow-sm min-w-0 overflow-hidden">
                      <CardHeader className="pb-2 border-b">
                        <CardTitle className="text-base">
                          Top provider / model (MTD)
                        </CardTitle>
                        <CardDescription>
                          vs same day-of-month range last month
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="pt-3 px-0">
                        {spendInsights.topBreakdown.length === 0 ? (
                          <p className="text-sm text-muted-foreground py-6 text-center px-4">
                            No MTD provider spend yet.
                          </p>
                        ) : (
                          <div className="overflow-x-auto max-w-full">
                            <table className="w-full min-w-[28rem]">
                              <thead>
                                <tr className="border-b bg-muted/50">
                                  <th className="text-left py-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                    Provider
                                  </th>
                                  <th className="text-left py-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                    Model
                                  </th>
                                  <th className="text-right py-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                    Cost
                                  </th>
                                  <th className="text-right py-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                    Prior
                                  </th>
                                  <th className="text-right py-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                    Δ
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {spendInsights.topBreakdown.map((row) => (
                                  <tr
                                    key={`${row.provider}:${row.model}`}
                                    className="border-b last:border-0 hover:bg-muted/40"
                                  >
                                    <td className="py-2 px-3 text-sm font-medium">
                                      {row.provider}
                                    </td>
                                    <td className="py-2 px-3 text-xs font-mono break-all">
                                      {row.model}
                                    </td>
                                    <td className="py-2 px-3 text-sm text-right tabular-nums">
                                      ${row.costUsd.toFixed(4)}
                                    </td>
                                    <td className="py-2 px-3 text-sm text-right tabular-nums text-muted-foreground">
                                      ${row.priorPeriodCostUsd.toFixed(4)}
                                    </td>
                                    <td
                                      className={`py-2 px-3 text-sm text-right tabular-nums ${
                                        row.deltaUsd > 0
                                          ? "text-amber-700 dark:text-amber-400"
                                          : row.deltaUsd < 0
                                            ? "text-emerald-700 dark:text-emerald-400"
                                            : ""
                                      }`}
                                    >
                                      {row.deltaUsd >= 0 ? "+" : ""}
                                      {row.deltaUsd.toFixed(4)}
                                      {row.deltaPct != null && (
                                        <span className="text-xs text-muted-foreground ml-1">
                                          ({row.deltaPct >= 0 ? "+" : ""}
                                          {row.deltaPct.toFixed(0)}%)
                                        </span>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </>
                ) : null}
              </section>

              {/* ── Efficiency + recommendations ──────────────────────── */}
              {spendInsights && (
                <section
                  className="space-y-3 min-w-0 border-t pt-6"
                  data-testid="direct-api-efficiency"
                  id="direct-api-efficiency"
                  aria-labelledby="direct-api-efficiency-heading"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2
                      id="direct-api-efficiency-heading"
                      className="text-sm font-semibold tracking-wide text-muted-foreground uppercase"
                    >
                      Efficiency &amp; actions
                    </h2>
                    <span className="text-xs text-muted-foreground">
                      Unit economics · optimization signals
                    </span>
                  </div>

                  {spendInsights.recommendations?.length > 0 && (
                    <Card className="shadow-sm border-sky-500/30 min-w-0">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base">
                          Optimization recommendations
                        </CardTitle>
                        <CardDescription>
                          Each item links evidence to estimated impact — classes
                          stay labeled
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        {spendInsights.recommendations
                          .slice(0, 8)
                          .map((rec, i) => (
                            <div
                              key={`${rec.kind}-${i}`}
                              className="rounded-md border px-3 py-2 text-sm min-w-0"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="font-medium break-words">
                                  {rec.title}
                                </p>
                                <Badge variant="secondary" className="text-xs">
                                  {rec.costClass.replace(/_/g, " ")}
                                </Badge>
                                <span className="text-xs tabular-nums text-muted-foreground ml-auto">
                                  ~${rec.estimatedImpactUsd.toFixed(2)} impact
                                </span>
                              </div>
                              <p className="text-xs text-muted-foreground mt-1 break-words">
                                {rec.message}
                              </p>
                              {rec.evidence && (
                                <p className="text-[11px] font-mono text-muted-foreground mt-1 break-all">
                                  Evidence:{" "}
                                  {typeof rec.evidence.detail === "string"
                                    ? rec.evidence.detail
                                    : JSON.stringify(rec.evidence).slice(
                                        0,
                                        160,
                                      )}
                                </p>
                              )}
                            </div>
                          ))}
                      </CardContent>
                    </Card>
                  )}

                  <Card className="shadow-sm min-w-0 overflow-hidden">
                    <CardHeader className="pb-2 border-b">
                      <CardTitle className="text-base">
                        Provider / model unit costs
                      </CardTitle>
                      <CardDescription>
                        Actual API billing — cost/request and $/1M output tokens
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="pt-3 px-0">
                      {!(spendInsights.efficiency?.provider?.length > 1) ? (
                        <p className="text-sm text-muted-foreground py-6 text-center px-4">
                          No efficiency rows for MTD provider spend.
                        </p>
                      ) : (
                        <div className="overflow-x-auto max-w-full">
                          <table className="w-full min-w-[28rem]">
                            <thead>
                              <tr className="border-b bg-muted/50">
                                <th className="text-left py-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                  Key
                                </th>
                                <th className="text-right py-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                  Cost
                                </th>
                                <th className="text-right py-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                  $/req
                                </th>
                                <th className="text-right py-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                  $/1M out
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {spendInsights.efficiency.provider
                                .filter((s) => s.dimension === "model")
                                .slice(0, 15)
                                .map((s) => (
                                  <tr
                                    key={s.key}
                                    className="border-b last:border-0 hover:bg-muted/40"
                                  >
                                    <td className="py-2 px-3 text-xs font-mono break-all">
                                      {s.key}
                                    </td>
                                    <td className="py-2 px-3 text-sm text-right tabular-nums">
                                      {s.costUsd == null
                                        ? "—"
                                        : `$${s.costUsd.toFixed(4)}`}
                                    </td>
                                    <td className="py-2 px-3 text-sm text-right tabular-nums">
                                      {s.costPerRequest == null
                                        ? "—"
                                        : `$${s.costPerRequest.toFixed(4)}`}
                                    </td>
                                    <td className="py-2 px-3 text-sm text-right tabular-nums">
                                      {s.costPer1MOutputTokens == null
                                        ? "—"
                                        : `$${s.costPer1MOutputTokens.toFixed(2)}`}
                                    </td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {spendInsights.efficiency?.agent?.some(
                    (s) => s.dimension === "project",
                  ) && (
                    <Card className="shadow-sm min-w-0 overflow-hidden">
                      <CardHeader className="pb-2 border-b">
                        <CardTitle className="text-base">
                          Project efficiency (agent-attributed)
                        </CardTitle>
                        <CardDescription>
                          Separate from actual provider billing — cost/session
                          when attribution exists
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="pt-3 px-0">
                        <div className="overflow-x-auto max-w-full">
                          <table className="w-full min-w-[28rem]">
                            <thead>
                              <tr className="border-b bg-muted/50">
                                <th className="text-left py-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                  Project
                                </th>
                                <th className="text-right py-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                  Cost
                                </th>
                                <th className="text-right py-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                  $/session
                                </th>
                                <th className="text-right py-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                  Cache $
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {spendInsights.efficiency.agent
                                .filter((s) => s.dimension === "project")
                                .slice(0, 12)
                                .map((s) => (
                                  <tr
                                    key={s.key}
                                    className="border-b last:border-0 hover:bg-muted/40"
                                  >
                                    <td className="py-2 px-3 text-sm break-all">
                                      {s.key}
                                    </td>
                                    <td className="py-2 px-3 text-sm text-right tabular-nums">
                                      {s.costUsd == null
                                        ? "—"
                                        : `$${s.costUsd.toFixed(4)}`}
                                    </td>
                                    <td className="py-2 px-3 text-sm text-right tabular-nums">
                                      {s.costPerSession == null
                                        ? "—"
                                        : `$${s.costPerSession.toFixed(4)}`}
                                    </td>
                                    <td className="py-2 px-3 text-sm text-right tabular-nums text-muted-foreground">
                                      {s.cacheSavingsUsd == null
                                        ? "—"
                                        : `~$${s.cacheSavingsUsd.toFixed(4)}`}
                                    </td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {spendInsights.scopedBudgets?.length > 0 && (
                    <Card className="shadow-sm min-w-0">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base">
                          Scoped budgets
                        </CardTitle>
                        <CardDescription>
                          Provider / model / project caps —{" "}
                          <Link
                            to="/settings?tab=budgets"
                            className="underline hover:text-foreground"
                          >
                            manage in Settings
                          </Link>
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        {spendInsights.scopedBudgets.map((b) => (
                          <div
                            key={b.id}
                            className="rounded-md border px-3 py-2 text-sm"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium">
                                {b.scopeType}/{b.scopeKey}
                              </span>
                              <Badge
                                variant={
                                  b.status === "critical"
                                    ? "destructive"
                                    : b.status === "warn"
                                      ? "secondary"
                                      : "outline"
                                }
                                className="text-xs"
                              >
                                {b.status}
                              </Badge>
                              <span className="text-xs tabular-nums text-muted-foreground ml-auto">
                                ${b.consumedUsd.toFixed(2)} / $
                                {b.monthlyBudgetUsd.toFixed(2)} (
                                {b.consumedPct.toFixed(0)}%)
                              </span>
                            </div>
                            <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                              <div
                                className={`h-full rounded-full ${
                                  b.status === "critical"
                                    ? "bg-destructive"
                                    : b.status === "warn"
                                      ? "bg-amber-500"
                                      : "bg-blue-500"
                                }`}
                                style={{
                                  width: `${Math.min(100, b.consumedPct)}%`,
                                }}
                              />
                            </div>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  )}

                  {spendInsights.alerts?.length > 0 && (
                    <Card
                      className="shadow-sm min-w-0"
                      data-testid="spend-alerts"
                    >
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base">
                          Alert delivery history
                        </CardTitle>
                        <CardDescription>
                          Threshold and anomaly alerts with delivery state
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        {spendInsights.alerts.slice(0, 12).map((a) => (
                          <div
                            key={a.id}
                            className="rounded-md border px-3 py-2 text-sm min-w-0"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-medium break-words">
                                {a.title}
                              </p>
                              <Badge variant="secondary" className="text-xs">
                                {a.kind}
                              </Badge>
                              <Badge variant="outline" className="text-xs">
                                {a.deliveryState}
                              </Badge>
                              <Badge
                                variant={
                                  a.severity === "critical"
                                    ? "destructive"
                                    : "secondary"
                                }
                                className="text-xs"
                              >
                                {a.severity}
                              </Badge>
                              {a.deliveryState !== "acknowledged" && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-xs ml-auto"
                                  onClick={() => {
                                    void acknowledgeSpendAlert(a.id).then(
                                      () => {
                                        void queryClient.invalidateQueries({
                                          queryKey: ["provider-spend-insights"],
                                        });
                                      },
                                    );
                                  }}
                                >
                                  Acknowledge
                                </Button>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-1 break-words">
                              {a.message}
                            </p>
                            {a.estimatedImpactUsd != null && (
                              <p className="text-[11px] tabular-nums text-muted-foreground mt-0.5">
                                Impact ${a.estimatedImpactUsd.toFixed(2)}
                                {a.deliveredAt
                                  ? ` · delivered ${a.deliveredAt}`
                                  : ""}
                              </p>
                            )}
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  )}
                </section>
              )}

              {/* ── Provider breakdown: selected range ─────────────────── */}
              <section
                className="space-y-3 min-w-0 border-t pt-6"
                data-testid="direct-api-attribution"
                aria-labelledby="direct-api-attribution-heading"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2
                    id="direct-api-attribution-heading"
                    className="text-sm font-semibold tracking-wide text-muted-foreground uppercase"
                  >
                    Provider breakdown
                  </h2>
                  <span className="text-xs text-muted-foreground">
                    Billing rows in selected range ({rangeLabel}) — not agent
                    matched
                  </span>
                </div>

                {providerLoading ? (
                  <Loading />
                ) : providerTotals.hasCost || providerTotals.tokens > 0 ? (
                  <>
                    <div className="flex flex-wrap gap-4 text-sm">
                      <span className="tabular-nums">
                        Tokens:{" "}
                        <strong>
                          {providerTotals.tokens.toLocaleString()}
                        </strong>
                      </span>
                      {providerTotals.hasCost && (
                        <span className="tabular-nums">
                          Cost:{" "}
                          <strong>${providerTotals.cost.toFixed(4)}</strong>
                        </span>
                      )}
                    </div>
                    <div className="overflow-x-auto max-w-full">
                      <table className="w-full min-w-[28rem]">
                        <thead>
                          <tr className="border-b bg-muted/50">
                            <th className="text-left py-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                              Provider
                            </th>
                            <th className="text-left py-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                              Model
                            </th>
                            <th className="text-right py-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                              Input
                            </th>
                            <th className="text-right py-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                              Output
                            </th>
                            <th className="text-right py-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                              Cost
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {(providerBreakdown ?? []).map((row) => (
                            <tr
                              key={`${row.provider}:${row.model}`}
                              className="border-b last:border-0 hover:bg-muted/40"
                            >
                              <td className="py-2 px-3 text-sm font-medium">
                                {row.provider}
                              </td>
                              <td className="py-2 px-3 text-xs font-mono break-all">
                                {row.model}
                              </td>
                              <td className="py-2 px-3 text-sm text-right tabular-nums">
                                {row.input_tokens.toLocaleString()}
                              </td>
                              <td className="py-2 px-3 text-sm text-right tabular-nums">
                                {row.output_tokens.toLocaleString()}
                              </td>
                              <td className="py-2 px-3 text-sm text-right tabular-nums">
                                {row.cost_usd != null
                                  ? `$${row.cost_usd.toFixed(4)}`
                                  : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  <div className="py-6 text-center space-y-1">
                    <p className="text-sm text-muted-foreground">
                      No Direct API Spend for this range.
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Configure provider keys under Capacity &amp; data health,
                      then Sync now. Agent session usage is under{" "}
                      <button
                        type="button"
                        className="underline hover:text-foreground"
                        onClick={() => updateParams({ view: "agent" })}
                      >
                        Agent Usage
                      </button>
                      .
                    </p>
                  </div>
                )}
              </section>

              {/* ── Capacity & data health (collapsed by default) ──────── */}
              <details
                className="group rounded-lg border border-dashed bg-muted/20 min-w-0"
                data-testid="direct-api-capacity-health"
              >
                <summary className="cursor-pointer list-none flex flex-wrap items-center justify-between gap-2 px-4 py-3 select-none [&::-webkit-details-marker]:hidden">
                  <div className="flex items-center gap-2 min-w-0">
                    <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
                    <span className="text-sm font-semibold">
                      Capacity &amp; data health
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    Plan usage · wallet · connectors · caveats
                  </span>
                </summary>
                <div className="border-t px-4 py-4 space-y-4 min-w-0">
                  <p className="text-xs text-muted-foreground">
                    Plan usage and wallet balances are <strong>not</strong> API
                    org spend. If OpenRouter BYOK and a direct provider (e.g.
                    Anthropic) are both configured, the same spend can appear
                    under both connectors.
                  </p>

                  {providerStatus && providerStatus.length > 0 && (
                    <div
                      className="flex flex-wrap gap-2"
                      data-testid="provider-status-chips"
                    >
                      {providerStatus.map((p) => (
                        <div
                          key={p.id}
                          className="flex flex-wrap items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm max-w-full"
                          title={
                            p.lastError || p.limitation || p.notes || undefined
                          }
                        >
                          <span className="font-medium">{p.name}</span>
                          <Badge variant={statusBadgeVariant(p.status)}>
                            {p.configured ? p.status : "not configured"}
                          </Badge>
                          {p.lastSuccessAt && (
                            <span className="text-xs text-muted-foreground">
                              synced{" "}
                              {new Date(p.lastSuccessAt).toLocaleString()}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {spendInsights?.syncWarnings
                    .filter((w) => w.reason === "limited")
                    .map((w) => (
                      <div
                        key={`${w.provider}-limited`}
                        className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm bg-muted/40"
                      >
                        <Info className="h-4 w-4 mt-0.5 shrink-0" />
                        <p className="font-medium">
                          {w.provider}: limited
                          {w.status ? ` (${w.status})` : ""}
                        </p>
                      </div>
                    ))}

                  <Card
                    className="border-dashed shadow-none"
                    data-testid="provider-plan-usage-card"
                  >
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Target className="h-4 w-4" />
                        Plan usage
                      </CardTitle>
                      <CardDescription>
                        Subscription / rate-limit windows (percent remaining).
                        Not wallet balance and not Direct API Spend. Expired
                        windows are never green.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      {creditsLoading ? (
                        <Loading />
                      ) : planUsageCredits.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          No plan-usage windows yet. Codex quotas appear after
                          session collection; Claude Pro limits are not exposed
                          via Admin API.
                        </p>
                      ) : (
                        <div className="space-y-3">
                          {planUsageCredits.every(
                            (c) =>
                              c.status === "expired" ||
                              c.status === "stale" ||
                              c.status === "unavailable",
                          ) && (
                            <p
                              className="text-sm text-muted-foreground"
                              data-testid="plan-usage-no-fresh"
                            >
                              No fresh plan capacity available. Last
                              observations are expired or unavailable.
                            </p>
                          )}
                          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                            {planUsageCredits.map((c) => (
                              <CreditSnapshotTile
                                key={`plan-${c.provider}-${c.label}-${c.asOf}`}
                                credit={c}
                              />
                            ))}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card
                    className="border-dashed shadow-none"
                    data-testid="provider-wallet-card"
                  >
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        <DollarSign className="h-4 w-4" />
                        Usage credits (wallet)
                      </CardTitle>
                      <CardDescription>
                        Prepaid credit balance when providers expose it. Never
                        mixed into Direct API Spend or session costs.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      {creditsLoading ? (
                        <Loading />
                      ) : walletCredits.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          No wallet snapshots yet. Configure provider keys and
                          click Sync now.
                        </p>
                      ) : (
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                          {walletCredits.map((c) => (
                            <CreditSnapshotTile
                              key={`wallet-${c.provider}-${c.label}-${c.asOf}`}
                              credit={c}
                            />
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {spendInsights && (
                    <p className="text-xs text-muted-foreground">
                      {spendInsights.meta.notes[0]}{" "}
                      {spendInsights.meta.partialMonth &&
                        "Partial-month forecast uses current burn. "}
                      Provider billing can lag finalization. Configure{" "}
                      <code className="text-[11px]">OPENROUTER_API_KEY</code>,{" "}
                      <code className="text-[11px]">ANTHROPIC_ADMIN_KEY</code>,{" "}
                      <code className="text-[11px]">OPENAI_ADMIN_KEY</code>,
                      and/or <code className="text-[11px]">XAI_API_KEY</code>.
                    </p>
                  )}
                </div>
              </details>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent
          value="attribution"
          className="space-y-4 mt-4 min-w-0"
          data-testid="attribution-panel"
        >
          <p className="text-sm text-muted-foreground max-w-3xl">
            Links provider billing (account-wide) to agent session usage
            {selectedSourceId ? ` for ${agentScope}` : ""}. Matched spend is
            rule-based with confidence — raw agent and provider totals are never
            summed. See{" "}
            <code className="text-xs">docs/spend-reconciliation.md</code>.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap gap-1.5 items-center">
              <span className="text-xs text-muted-foreground mr-1">
                Providers
              </span>
              <Button
                size="sm"
                variant={includedProviders == null ? "default" : "outline"}
                onClick={() => setIncludedProviders(null)}
              >
                All
              </Button>
              {PROVIDER_FILTER_OPTIONS.map((p) => {
                const active =
                  includedProviders != null && includedProviders.includes(p);
                return (
                  <Button
                    key={p}
                    size="sm"
                    variant={active ? "default" : "outline"}
                    onClick={() => {
                      setIncludedProviders((prev) => {
                        if (prev == null) return [p];
                        if (prev.includes(p)) {
                          const next = prev.filter((x) => x !== p);
                          return next.length ? next : null;
                        }
                        return [...prev, p];
                      });
                    }}
                  >
                    {p}
                  </Button>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-1.5 items-center">
              <span className="text-xs text-muted-foreground mr-1">BYOK</span>
              {BYOK_OPTIONS.map((o) => (
                <Button
                  key={o.value}
                  size="sm"
                  variant={byokTreatment === o.value ? "default" : "outline"}
                  onClick={() => setByokTreatment(o.value)}
                >
                  {o.label}
                </Button>
              ))}
            </div>
          </div>

          {reconLoading ? (
            <Loading />
          ) : reconError ? (
            <Card className="border-destructive">
              <CardContent className="py-6">
                <p className="font-medium text-destructive">
                  Failed to load reconciliation
                </p>
                <p className="text-sm text-muted-foreground">
                  {reconError instanceof Error
                    ? reconError.message
                    : "Unknown error"}
                </p>
              </CardContent>
            </Card>
          ) : reconciliation ? (
            <>
              <div
                className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
                data-testid="attribution-summary"
              >
                <Card className="overflow-hidden border-l-4 border-l-emerald-500">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Matched spend
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold tabular-nums">
                      ${reconciliation.summary.matchedSpendUsd.toFixed(4)}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Exact + likely only
                    </p>
                  </CardContent>
                </Card>
                <Card className="overflow-hidden border-l-4 border-l-amber-500">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Unmatched spend
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold tabular-nums">
                      $
                      {reconciliation.summary.unmatchedProviderSpendUsd.toFixed(
                        4,
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Provider cost without agent use
                    </p>
                  </CardContent>
                </Card>
                <Card className="overflow-hidden border-l-4 border-l-sky-500">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Usage without cost
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold tabular-nums">
                      {reconciliation.summary.agentTokensWithoutBilling.toLocaleString()}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Agent tokens, no billing match
                    </p>
                  </CardContent>
                </Card>
                <Card className="overflow-hidden border-l-4 border-l-rose-500">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Duplicate risk
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold tabular-nums">
                      ${reconciliation.summary.duplicateRiskSpendUsd.toFixed(4)}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      OpenRouter ∩ direct overlap
                    </p>
                  </CardContent>
                </Card>
                <Card className="overflow-hidden border-l-4 border-l-blue-500">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Coverage
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold tabular-nums">
                      {reconciliation.summary.coveragePct != null
                        ? `${reconciliation.summary.coveragePct}%`
                        : "—"}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Matched / provider spend
                      {reconciliation.summary.providerSpendUsd > 0 && (
                        <>
                          {" "}
                          ($
                          {reconciliation.summary.providerSpendUsd.toFixed(4)})
                        </>
                      )}
                    </p>
                  </CardContent>
                </Card>
              </div>

              {reconciliation.summary.hasAgentLogCost && (
                <p className="text-xs text-muted-foreground flex items-start gap-1.5">
                  <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  Session-log cost in this range: $
                  {(reconciliation.summary.agentLogCostUsd ?? 0).toFixed(
                    4,
                  )}{" "}
                  (provenance: session-log — not included in provider spend).
                </p>
              )}

              {reconciliation.notes.length > 0 && (
                <Card data-testid="attribution-notes">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                      Reconciliation notes
                    </CardTitle>
                    <CardDescription>
                      Data lag, BYOK risk, and separation guarantees
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground">
                      {reconciliation.notes.map((n) => (
                        <li key={n}>{n}</li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}

              <Card data-testid="attribution-matches">
                <CardHeader>
                  <CardTitle className="text-base">
                    Match evidence ({reconciliation.matches.length})
                  </CardTitle>
                  <CardDescription>
                    Expand a row for provider contributions, agent sources, and
                    the rule that fired
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  {reconciliation.matches.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      No provider billing or agent usage in this range.
                    </p>
                  ) : (
                    <div className="overflow-x-auto max-w-full">
                      <table className="w-full min-w-[40rem]">
                        <thead>
                          <tr className="border-b bg-muted/50">
                            <th className="text-left py-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                              Day
                            </th>
                            <th className="text-left py-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                              Model
                            </th>
                            <th className="text-left py-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                              Class
                            </th>
                            <th className="text-right py-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                              Provider $
                            </th>
                            <th className="text-right py-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                              Agent tokens
                            </th>
                            <th className="text-right py-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                              Confidence
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {reconciliation.matches.map((m) => {
                            const open = expandedMatchKey === m.key;
                            const agentTok = m.agent
                              ? m.agent.inputTokens + m.agent.outputTokens
                              : 0;
                            return (
                              <Fragment key={m.key}>
                                <tr
                                  className="border-b last:border-0 hover:bg-muted/40 cursor-pointer"
                                  onClick={() =>
                                    setExpandedMatchKey(open ? null : m.key)
                                  }
                                  data-testid={`match-row-${m.classification}`}
                                >
                                  <td className="py-2 px-3 text-sm tabular-nums whitespace-nowrap">
                                    <span className="inline-flex items-center gap-1">
                                      <ChevronDown
                                        className={`h-3.5 w-3.5 transition-transform ${
                                          open ? "rotate-180" : ""
                                        }`}
                                      />
                                      {m.day}
                                    </span>
                                  </td>
                                  <td className="py-2 px-3 text-xs font-mono break-all">
                                    {m.canonicalModel}
                                  </td>
                                  <td className="py-2 px-3">
                                    <Badge
                                      variant={classificationBadgeVariant(
                                        m.classification,
                                      )}
                                    >
                                      {classificationLabel(m.classification)}
                                    </Badge>
                                  </td>
                                  <td className="py-2 px-3 text-sm text-right tabular-nums">
                                    ${m.providerCostUsd.toFixed(4)}
                                  </td>
                                  <td className="py-2 px-3 text-sm text-right tabular-nums">
                                    {agentTok.toLocaleString()}
                                  </td>
                                  <td className="py-2 px-3 text-sm text-right tabular-nums">
                                    {(m.confidence * 100).toFixed(0)}%
                                  </td>
                                </tr>
                                {open && (
                                  <tr className="border-b bg-muted/20">
                                    <td colSpan={6} className="px-4 py-3">
                                      <div className="grid gap-3 sm:grid-cols-2 text-sm">
                                        <div>
                                          <p className="text-xs font-semibold uppercase text-muted-foreground mb-1">
                                            Rule / evidence
                                          </p>
                                          <p>
                                            <code className="text-xs">
                                              {m.ruleHit}
                                            </code>
                                            {m.tokenRatio != null && (
                                              <span className="text-muted-foreground ml-2">
                                                token Δ ratio{" "}
                                                {(m.tokenRatio * 100).toFixed(
                                                  1,
                                                )}
                                                %
                                              </span>
                                            )}
                                          </p>
                                          <p className="text-xs text-muted-foreground mt-1">
                                            Key: {m.key}
                                          </p>
                                        </div>
                                        <div>
                                          <p className="text-xs font-semibold uppercase text-muted-foreground mb-1">
                                            Providers
                                          </p>
                                          {m.provider.length === 0 ? (
                                            <p className="text-muted-foreground">
                                              None
                                            </p>
                                          ) : (
                                            <ul className="space-y-1">
                                              {m.provider.map((p) => (
                                                <li key={p.provider}>
                                                  <strong>{p.provider}</strong>:
                                                  ${(p.costUsd ?? 0).toFixed(4)}{" "}
                                                  ·{" "}
                                                  {(
                                                    p.inputTokens +
                                                    p.outputTokens
                                                  ).toLocaleString()}{" "}
                                                  tok · {p.requestCount} req
                                                  {p.rawModels.length > 0 && (
                                                    <span className="text-xs text-muted-foreground block font-mono">
                                                      {p.rawModels.join(", ")}
                                                    </span>
                                                  )}
                                                </li>
                                              ))}
                                            </ul>
                                          )}
                                        </div>
                                        <div className="sm:col-span-2">
                                          <p className="text-xs font-semibold uppercase text-muted-foreground mb-1">
                                            Agent
                                          </p>
                                          {!m.agent ? (
                                            <p className="text-muted-foreground">
                                              No agent usage for this day/model
                                            </p>
                                          ) : (
                                            <p>
                                              Sources:{" "}
                                              {m.agent.sourceIds.join(", ") ||
                                                "—"}{" "}
                                              ·{" "}
                                              {(
                                                m.agent.inputTokens +
                                                m.agent.outputTokens
                                              ).toLocaleString()}{" "}
                                              tokens · {m.agent.requestCount}{" "}
                                              requests
                                              {m.agent.hasLogCost && (
                                                <span className="text-muted-foreground">
                                                  {" "}
                                                  · session-log $
                                                  {(
                                                    m.agent.logCostUsd ?? 0
                                                  ).toFixed(4)}
                                                </span>
                                              )}
                                              {m.agent.rawModels.length > 0 && (
                                                <span className="text-xs text-muted-foreground block font-mono mt-0.5">
                                                  {m.agent.rawModels.join(", ")}
                                                </span>
                                              )}
                                            </p>
                                          )}
                                        </div>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          ) : null}
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** MTD daily trend chart — mounts only when the container has positive size (BSH-98 Recharts fix). */
function DailySpendTrendChart({
  points,
}: {
  points: Array<{
    day: string;
    costUsd: number;
    priorPeriodCostUsd: number | null;
    deltaUsd: number | null;
  }>;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const measure = () => {
      const w = Math.floor(el.clientWidth);
      const h = Math.floor(el.clientHeight);
      setBox((prev) =>
        prev.w === w && prev.h === h
          ? prev
          : { w: Math.max(0, w), h: Math.max(0, h) },
      );
    };
    measure();
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const data = useMemo(
    () =>
      points.map((p) => ({
        ...p,
        priorPlot: p.priorPeriodCostUsd ?? undefined,
      })),
    [points],
  );

  return (
    <div
      ref={hostRef}
      className="h-56 w-full min-w-0 min-h-[14rem] overflow-hidden"
      data-testid="daily-spend-trend-chart"
    >
      {box.w > 0 && box.h > 0 ? (
        <ResponsiveContainer width={box.w} height={box.h} debounce={50}>
          <AreaChart data={data}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              dataKey="day"
              tick={{ fontSize: 11 }}
              tickFormatter={(value: string) => {
                const d = new Date(value + "T00:00:00Z");
                return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
              }}
            />
            <YAxis
              tick={{ fontSize: 11 }}
              tickFormatter={(v: number) => `$${v.toFixed(0)}`}
              width={40}
            />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0]?.payload as {
                  costUsd: number;
                  priorPeriodCostUsd: number | null;
                  deltaUsd: number | null;
                };
                return (
                  <div className="rounded-lg border bg-background p-3 shadow-md text-sm">
                    <p className="font-medium mb-1">{label}</p>
                    <p>This month: ${row.costUsd.toFixed(4)}</p>
                    {row.priorPeriodCostUsd != null && (
                      <p className="text-muted-foreground">
                        Prior month: ${row.priorPeriodCostUsd.toFixed(4)}
                        {row.deltaUsd != null && (
                          <>
                            {" "}
                            ({row.deltaUsd >= 0 ? "+" : ""}
                            {row.deltaUsd.toFixed(4)})
                          </>
                        )}
                      </p>
                    )}
                  </div>
                );
              }}
            />
            <Legend />
            <Area
              type="monotone"
              dataKey="priorPlot"
              stroke="#94a3b8"
              fill="#94a3b8"
              fillOpacity={0.08}
              strokeDasharray="4 4"
              name="Prior month"
              connectNulls={false}
            />
            <Area
              type="monotone"
              dataKey="costUsd"
              stroke="#10b981"
              fill="#10b981"
              fillOpacity={0.15}
              name="This month"
            />
          </AreaChart>
        </ResponsiveContainer>
      ) : null}
    </div>
  );
}

function formatCreditRemaining(c: ProviderCredit): string {
  if (c.remaining == null) {
    if (c.status === "unavailable" || c.status === "limited") {
      return "—";
    }
    return "—";
  }
  if (c.unit === "usd") return `$${c.remaining.toFixed(2)}`;
  if (c.unit === "percent") return `${c.remaining.toFixed(0)}% left`;
  if (c.unit === "tokens") return `${c.remaining.toLocaleString()} tokens`;
  if (c.unit === "requests") return `${c.remaining.toLocaleString()} req`;
  return `${c.remaining.toLocaleString()} ${c.unit}`;
}

function creditLabelDisplay(label: string): string {
  if (label === "prepaid_balance") return "Wallet balance";
  if (label === "plan_usage_unavailable") return "Plan limits";
  if (label.startsWith("quota_")) {
    return label.replace(/^quota_/, "Usage window · ").replace(/_/g, " ");
  }
  return label;
}

function creditStatusBadgeVariant(
  status: string,
): "default" | "destructive" | "secondary" | "outline" {
  if (status === "ok") return "default";
  if (status === "error") return "destructive";
  // stale / expired must never look green/actionable
  if (status === "expired" || status === "stale") return "outline";
  return "secondary";
}

function isCreditFreshnessDemoted(status: string): boolean {
  return status === "expired" || status === "stale";
}

function CreditSnapshotTile({ credit }: { credit: ProviderCredit }) {
  const freshnessReason =
    typeof credit.details?.freshnessReason === "string"
      ? credit.details.freshnessReason
      : null;
  const note =
    freshnessReason ??
    (typeof credit.details?.note === "string"
      ? credit.details.note
      : typeof credit.details?.productLanguage === "string"
        ? credit.details.productLanguage
        : null);
  const demoted = isCreditFreshnessDemoted(credit.status);

  return (
    <div
      className={`rounded-md border px-3 py-2.5 space-y-1 ${
        demoted ? "opacity-80 border-dashed" : ""
      }`}
      data-testid={`credit-${credit.provider}-${credit.label}`}
      data-credit-status={credit.status}
      title={note ?? undefined}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium capitalize">
          {credit.provider}
        </span>
        <Badge variant={creditStatusBadgeVariant(credit.status)}>
          {credit.status}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        {creditLabelDisplay(credit.label)}
        {credit.source === "session_quota" ? " · session quota" : ""}
        {credit.source === "provider_api" ? " · provider API" : ""}
        {credit.source === "unavailable" ? " · not available" : ""}
      </p>
      <p
        className={`text-lg font-semibold tabular-nums ${
          demoted
            ? "text-muted-foreground line-through decoration-muted-foreground/60"
            : ""
        }`}
      >
        {formatCreditRemaining(credit)}
      </p>
      {demoted && (
        <p
          className="text-xs text-muted-foreground"
          data-testid="credit-freshness-reason"
        >
          {freshnessReason ??
            (credit.status === "expired"
              ? "Quota window expired — not actionable."
              : "Snapshot is stale — re-sync or collect a new session.")}
        </p>
      )}
      <p className="text-[11px] text-muted-foreground">
        as of {new Date(credit.asOf).toLocaleString()}
      </p>
    </div>
  );
}
