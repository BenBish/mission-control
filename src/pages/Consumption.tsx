import { useCallback, useEffect, useMemo, useState } from "react";
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
  useConsumption,
  useProviderBreakdown,
  useProviderStatus,
  useProviderSpendInsights,
  useProviderCredits,
  triggerProviderSync,
  type ProviderCredit,
} from "@/lib/queries";
import {
  getAgentUsageSince,
  getProviderUsageSinceDay,
  type DatePreset,
} from "@/lib/date-range";

type Unit = "tokens" | "compute" | "usd";
type ConsumptionView = "agent" | "direct-api";

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
  return raw === "direct-api" ? "direct-api" : "agent";
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
    const viewOk = rawView === "agent" || rawView === "direct-api";
    const rangeOk =
      rawRange === "today" ||
      rawRange === "7d" ||
      rawRange === "30d" ||
      rawRange === "all";
    const unitOk =
      parseView(rawView) === "direct-api"
        ? rawUnit == null
        : rawUnit === "tokens" || rawUnit === "compute" || rawUnit === "usd";
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
    data: rows,
    isLoading,
    error,
  } = useConsumption({ since: agentSince, sourceId: selectedSourceId });

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

  const bySourceModel = useMemo(() => {
    if (!rows) return [];
    const grouped = new Map<
      string,
      {
        sourceId: string;
        model: string;
        inputTokens: number;
        outputTokens: number;
        computeSeconds: number;
        costUsd: number | null;
        hasCost: boolean;
      }
    >();
    for (const row of rows) {
      const key = `${row.source_id}:${row.model ?? "unknown"}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.inputTokens += row.input_tokens;
        existing.outputTokens += row.output_tokens;
        existing.computeSeconds += row.compute_seconds;
        if (row.cost_usd != null) {
          existing.costUsd = (existing.costUsd ?? 0) + row.cost_usd;
          existing.hasCost = true;
        }
      } else {
        grouped.set(key, {
          sourceId: row.source_id,
          model: row.model ?? "unknown",
          inputTokens: row.input_tokens,
          outputTokens: row.output_tokens,
          computeSeconds: row.compute_seconds,
          costUsd: row.cost_usd,
          hasCost: row.cost_usd != null,
        });
      }
    }
    return Array.from(grouped.values()).sort(
      (a, b) =>
        b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens),
    );
  }, [rows]);

  const totals = useMemo(() => {
    return bySourceModel.reduce(
      (acc, row) => ({
        tokens: acc.tokens + row.inputTokens + row.outputTokens,
        compute: acc.compute + row.computeSeconds,
        cost: row.hasCost ? acc.cost + (row.costUsd ?? 0) : acc.cost,
        hasCost: acc.hasCost || row.hasCost,
      }),
      { tokens: 0, compute: 0, cost: 0, hasCost: false },
    );
  }, [bySourceModel]);

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
  const pageDescription = `Agent session usage for ${agentScope}; Direct API Spend is account-wide — separate datasets, not summed together`;

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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="agent" className="gap-1.5">
              <Bot className="h-4 w-4" />
              Agent Usage
            </TabsTrigger>
            <TabsTrigger value="direct-api" className="gap-1.5">
              <Cloud className="h-4 w-4" />
              Direct API Spend
            </TabsTrigger>
          </TabsList>

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
              <div className="sm:max-w-xs">
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
              </div>

              {bySourceModel.length > 0 ? (
                <Card className="shadow-sm">
                  <CardHeader className="pb-4 border-b">
                    <CardTitle className="text-lg">By Source & Model</CardTitle>
                    <CardDescription>
                      Agent Usage over the selected date range
                      {selectedSourceId ? ` · filtered to ${agentScope}` : ""}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pt-4 px-0">
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b bg-muted/50">
                            <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                              Source
                            </th>
                            <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                              Model
                            </th>
                            {unit === "tokens" && (
                              <>
                                <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                  Input
                                </th>
                                <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                  Output
                                </th>
                              </>
                            )}
                            {unit === "compute" && (
                              <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                Compute
                              </th>
                            )}
                            {unit === "usd" && (
                              <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                Cost
                              </th>
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {bySourceModel.map((row) => (
                            <tr
                              key={`${row.sourceId}:${row.model}`}
                              className="border-b last:border-0 hover:bg-muted/40"
                            >
                              <td className="py-3 px-4 text-sm">
                                <span className="font-medium">
                                  {row.sourceId}
                                </span>
                              </td>
                              <td className="py-3 px-4 text-sm font-mono text-xs">
                                {row.model}
                              </td>
                              {unit === "tokens" && (
                                <>
                                  <td className="py-3 px-4 text-sm text-right tabular-nums">
                                    {row.inputTokens.toLocaleString()}
                                  </td>
                                  <td className="py-3 px-4 text-sm text-right tabular-nums">
                                    {row.outputTokens.toLocaleString()}
                                  </td>
                                </>
                              )}
                              {unit === "compute" && (
                                <td className="py-3 px-4 text-sm text-right tabular-nums">
                                  {row.computeSeconds > 0
                                    ? formatCompute(row.computeSeconds)
                                    : "—"}
                                </td>
                              )}
                              {unit === "usd" && (
                                <td className="py-3 px-4 text-sm text-right tabular-nums">
                                  {row.hasCost
                                    ? `$${(row.costUsd ?? 0).toFixed(4)}`
                                    : "—"}
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
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

        <TabsContent value="direct-api" className="space-y-4 mt-4">
          <Card className="shadow-sm border-dashed">
            <CardHeader className="pb-4 border-b">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Cloud className="h-5 w-5" />
                      Direct API Spend
                    </CardTitle>
                    <Badge variant="secondary">Account-wide</Badge>
                  </div>
                  <CardDescription className="max-w-2xl">
                    <strong>API org spend</strong> — daily usage/cost from
                    provider Admin billing APIs (OpenRouter, Anthropic, OpenAI,
                    xAI). Separate from agent session logs, from{" "}
                    <em>Plan usage</em> windows, and from{" "}
                    <em>Usage credits (wallet)</em>. Not double-counted with
                    Agent Usage totals. Budget and forecast use the current
                    calendar month ({spendInsights?.meta.timezone ?? "UTC"}).
                  </CardDescription>
                  {selectedSourceId && (
                    <p className="text-xs text-amber-700 dark:text-amber-400 flex items-start gap-1.5">
                      <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      Source filter “{agentScope}” does not apply here —
                      provider billing is account-wide and cannot be scoped to a
                      single agent source.
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground flex items-start gap-1.5">
                    <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    If OpenRouter BYOK and a direct provider (e.g. Anthropic)
                    are both configured, the same spend can appear under both
                    connectors.
                  </p>
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
                <p className="text-xs text-muted-foreground mt-2 font-mono">
                  {syncMessage}
                </p>
              )}
            </CardHeader>
            <CardContent className="pt-4 space-y-6">
              {providerStatus && providerStatus.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {providerStatus.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm"
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
                          synced {new Date(p.lastSuccessAt).toLocaleString()}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* BSH-93: Plan usage (#1) — separate from wallet (#2) and spend (#3) */}
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
                    Account-wide. Not wallet balance and not Direct API Spend.
                    Codex session quotas appear here when collected. Windows
                    past their reset are marked expired (never green). Claude
                    Pro / Claude Code plan bars are not available via Anthropic
                    Admin API.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {creditsLoading ? (
                    <Loading />
                  ) : planUsageCredits.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No plan-usage windows yet. Codex quotas appear after
                      session collection; Claude Pro limits are not exposed via
                      Admin API.
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
                          No fresh plan capacity available. Last observations
                          are expired or unavailable — collect a new Codex
                          session quota or wait for the next window.
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

              {/* BSH-93: Usage credits wallet (#2) */}
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
                    Prepaid credit balance when providers expose it (e.g.
                    OpenRouter). Never fabricated as $0 when unavailable.
                    Anthropic Admin and OpenAI secret keys do not expose
                    wallets. Not mixed into Direct API Spend or session costs.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {creditsLoading ? (
                    <Loading />
                  ) : walletCredits.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No wallet snapshots yet. Configure provider keys and click
                      Sync now.
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
                  {/* Sync reliability warnings */}
                  {spendInsights.syncWarnings.filter(
                    (w) =>
                      w.reason === "error" ||
                      w.reason === "stale" ||
                      w.reason === "limited" ||
                      w.reason === "no_sync_data",
                  ).length > 0 && (
                    <div className="space-y-2">
                      {spendInsights.syncWarnings
                        .filter(
                          (w) =>
                            w.reason === "error" ||
                            w.reason === "stale" ||
                            w.reason === "limited" ||
                            w.reason === "no_sync_data",
                        )
                        .map((w) => (
                          <div
                            key={`${w.provider}-${w.reason}`}
                            className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${
                              w.reason === "error" ||
                              w.reason === "stale" ||
                              w.reason === "no_sync_data"
                                ? "border-amber-500/50 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200"
                                : "border-border bg-muted/40"
                            }`}
                          >
                            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                            <div>
                              {w.reason === "no_sync_data" ? (
                                <>
                                  <p className="font-medium">
                                    No usable provider sync history
                                  </p>
                                  <p className="text-xs opacity-90 mt-0.5">
                                    Configure provider credentials and sync, or
                                    wait for a successful connector run.
                                    Forecast is marked unreliable until at least
                                    one provider has a recent successful sync.
                                  </p>
                                </>
                              ) : (
                                <>
                                  <p className="font-medium">
                                    {w.provider}: {w.reason}
                                    {w.status ? ` (${w.status})` : ""}
                                  </p>
                                  {w.lastError && (
                                    <p className="text-xs opacity-90 mt-0.5">
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
                                      . Forecast marked unreliable until sync is
                                      fresh.
                                    </p>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        ))}
                    </div>
                  )}

                  {/* Budget / burn / forecast */}
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Card className="overflow-hidden border-l-4 border-l-emerald-500">
                      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">
                          MTD spent
                        </CardTitle>
                        <DollarSign className="h-4 w-4 text-emerald-600" />
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold tabular-nums">
                          ${spendInsights.budget.consumedUsd.toFixed(2)}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {spendInsights.meta.monthStart} →{" "}
                          {spendInsights.meta.today} (
                          {spendInsights.meta.timezone})
                        </p>
                      </CardContent>
                    </Card>

                    <Card className="overflow-hidden border-l-4 border-l-blue-500">
                      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">
                          Budget remaining
                        </CardTitle>
                        <Target className="h-4 w-4 text-blue-600" />
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
                              {(spendInsights.budget.remainingUsd ?? 0).toFixed(
                                2,
                              )}
                            </div>
                            <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
                              <div
                                className={`h-full rounded-full ${
                                  (spendInsights.budget.consumedPct ?? 0) >= 100
                                    ? "bg-destructive"
                                    : (spendInsights.budget.consumedPct ?? 0) >=
                                        80
                                      ? "bg-amber-500"
                                      : "bg-blue-500"
                                }`}
                                style={{
                                  width: `${Math.min(100, spendInsights.budget.consumedPct ?? 0)}%`,
                                }}
                              />
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">
                              {(spendInsights.budget.consumedPct ?? 0).toFixed(
                                1,
                              )}
                              % of $
                              {spendInsights.budget.monthlyBudgetUsd.toFixed(2)}
                            </p>
                          </>
                        )}
                      </CardContent>
                    </Card>

                    <Card className="overflow-hidden border-l-4 border-l-purple-500">
                      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">
                          Burn rate
                        </CardTitle>
                        <TrendingUp className="h-4 w-4 text-purple-600" />
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
                      className={`overflow-hidden border-l-4 ${
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
                          ${spendInsights.forecastMonthEndUsd.toFixed(2)}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {spendInsights.meta.forecastReliable
                            ? "Extrapolated from current burn"
                            : spendInsights.syncWarnings.some(
                                  (w) => w.reason === "no_sync_data",
                                )
                              ? "No sync history — do not trust this figure"
                              : "Stale/failed sync — do not trust this figure"}
                        </p>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Daily trend */}
                  <Card className="shadow-sm">
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
                        <div className="h-56 w-full min-w-0">
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart
                              data={spendInsights.dailyTrend.map((p) => ({
                                ...p,
                                priorPlot: p.priorPeriodCostUsd ?? undefined,
                              }))}
                            >
                              <CartesianGrid
                                strokeDasharray="3 3"
                                className="stroke-border"
                              />
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
                                tickFormatter={(v: number) =>
                                  `$${v.toFixed(0)}`
                                }
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
                                      <p className="font-medium mb-1">
                                        {label}
                                      </p>
                                      <p>
                                        This month: ${row.costUsd.toFixed(4)}
                                      </p>
                                      {row.priorPeriodCostUsd != null && (
                                        <p className="text-muted-foreground">
                                          Prior month: $
                                          {row.priorPeriodCostUsd.toFixed(4)}
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
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Anomalies */}
                  {spendInsights.anomalies.length > 0 && (
                    <Card className="shadow-sm border-amber-500/40">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base flex items-center gap-2">
                          <AlertTriangle className="h-4 w-4 text-amber-600" />
                          Spend anomalies
                        </CardTitle>
                        <CardDescription>
                          ≥2× rolling 7-day baseline and ≥$1 (see calculation
                          notes)
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        {spendInsights.anomalies.slice(0, 10).map((a, i) => (
                          <div
                            key={`${a.kind}-${a.day}-${a.provider}-${a.model}-${i}`}
                            className="rounded-md border px-3 py-2 text-sm"
                          >
                            <p className="font-medium">{a.message}</p>
                            <p className="text-xs text-muted-foreground mt-0.5 tabular-nums">
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

                  {/* MTD breakdown with prior-period delta */}
                  <Card className="shadow-sm">
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
                        <div className="overflow-x-auto">
                          <table className="w-full">
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
                                  <td className="py-2 px-3 text-xs font-mono">
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

                  <p className="text-xs text-muted-foreground">
                    {spendInsights.meta.notes[0]}{" "}
                    {spendInsights.meta.partialMonth &&
                      "Partial-month forecast uses current burn. "}
                    Provider billing can lag finalization.
                  </p>
                </>
              ) : null}

              {/* Range-filtered breakdown (existing range presets) */}
              <div className="border-t pt-4 space-y-3">
                <h3 className="text-sm font-medium">
                  Usage in selected range ({rangeLabel})
                </h3>
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
                    <div className="overflow-x-auto">
                      <table className="w-full">
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
                              <td className="py-2 px-3 text-xs font-mono">
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
                      Configure{" "}
                      <code className="text-xs">OPENROUTER_API_KEY</code>,{" "}
                      <code className="text-xs">ANTHROPIC_ADMIN_KEY</code>,{" "}
                      <code className="text-xs">OPENAI_ADMIN_KEY</code>, and/or{" "}
                      <code className="text-xs">XAI_API_KEY</code>, then click
                      Sync now. Agent session usage is under the{" "}
                      <button
                        type="button"
                        className="underline hover:text-foreground"
                        onClick={() => updateParams({ view: "agent" })}
                      >
                        Agent Usage
                      </button>{" "}
                      view.
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
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
