import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/_shared/PageHeader";
import { Loading } from "@/components/_shared/Loading";
import { Calendar, Cloud, Bot, Link2, Gauge, RefreshCw } from "lucide-react";
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
  type AgentUsageDimension,
  type ByokTreatment,
} from "@/lib/queries";
import {
  getAgentUsageSince,
  getProviderUsageSinceDay,
  type DatePreset,
} from "@/lib/date-range";
import { AgentUsageTab } from "@/components/consumption/AgentUsageTab";
import { AttributionTab } from "@/components/consumption/AttributionTab";
import { DirectApiTab } from "@/components/consumption/DirectApiTab";
import { CapacityAndDataHealth } from "@/components/consumption/CapacityAndDataHealth";
import { DATE_PRESETS } from "@/components/consumption/constants";
import {
  parseRange,
  parseUnit,
  parseView,
} from "@/components/consumption/helpers";
import type { ConsumptionView, Unit } from "@/components/consumption/types";

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
      rawView === "plan-wallet" ||
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

  // Preserve legacy deep links to the capacity section that previously lived
  // inside Direct API Spend, while moving operators to the correct data class.
  useEffect(() => {
    if (view === "direct-api" && window.location.hash === "#capacity") {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("view", "plan-wallet");
          return next;
        },
        { replace: true },
      );
    }
  }, [setSearchParams, view]);

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
  const pageDescription = `Agent usage for ${agentScope}; subscription capacity, prepaid wallets, and account-wide Direct API Spend stay separate; Attribution links usage and spend without summing blindly`;

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
          {/* Scrollable tab strip so labels never widen the page at 390px */}
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
              <TabsTrigger value="plan-wallet" className="gap-1.5 shrink-0">
                <Gauge className="h-4 w-4 shrink-0" />
                Plan usage &amp; wallet
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
          <AgentUsageTab
            unit={unit}
            totals={totals}
            agentUsage={agentUsage}
            coverage={coverage}
            selectedSourceId={selectedSourceId}
            agentScope={agentScope}
            updateParams={updateParams}
            includeNonMaterial={includeNonMaterial}
            setIncludeNonMaterial={setIncludeNonMaterial}
            agentDimension={agentDimension}
            setAgentDimension={setAgentDimension}
            expandedDriverKey={expandedDriverKey}
            setExpandedDriverKey={setExpandedDriverKey}
            drivers={drivers}
            drillLoading={drillLoading}
            drillSessions={drillSessions}
            since={agentSince}
          />
        </TabsContent>

        <TabsContent value="direct-api" className="space-y-4 mt-4 min-w-0">
          <DirectApiTab
            selectedSourceId={selectedSourceId}
            agentScope={agentScope}
            spendInsights={spendInsights}
            insightsLoading={insightsLoading}
            insightsError={insightsError}
            syncing={syncing}
            syncMessage={syncMessage}
            onProviderSync={handleProviderSync}
            rangeLabel={rangeLabel}
            providerLoading={providerLoading}
            providerTotals={providerTotals}
            providerBreakdown={providerBreakdown}
            updateParams={updateParams}
            since={providerSince}
          />
        </TabsContent>

        <TabsContent value="plan-wallet" className="space-y-4 mt-4 min-w-0">
          <Card className="shadow-sm border-dashed min-w-0 overflow-hidden">
            <CardContent className="pt-6 space-y-6 min-w-0">
              <div>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                      <Gauge className="h-5 w-5 shrink-0" />
                      Plan usage &amp; wallet
                    </h3>
                    <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
                      Subscription windows and prepaid balances are capacity,
                      not API organization spend. Unavailable slots remain
                      explicit instead of being inferred from other windows.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleProviderSync()}
                    disabled={syncing}
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 mr-1.5 ${syncing ? "animate-spin" : ""}`}
                    />
                    {syncing ? "Syncing…" : "Sync capacity"}
                  </Button>
                </div>
                {syncMessage && (
                  <p className="text-xs text-muted-foreground mt-2 font-mono break-all">
                    {syncMessage}
                  </p>
                )}
              </div>
              <CapacityAndDataHealth
                creditsLoading={creditsLoading}
                planUsageCredits={planUsageCredits}
                walletCredits={walletCredits}
                providerStatus={providerStatus}
                spendInsights={spendInsights}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent
          value="attribution"
          className="space-y-4 mt-4 min-w-0"
          data-testid="attribution-panel"
        >
          <AttributionTab
            selectedSourceId={selectedSourceId}
            agentScope={agentScope}
            includedProviders={includedProviders}
            setIncludedProviders={setIncludedProviders}
            byokTreatment={byokTreatment}
            setByokTreatment={setByokTreatment}
            reconLoading={reconLoading}
            reconError={reconError}
            reconciliation={reconciliation}
            expandedMatchKey={expandedMatchKey}
            setExpandedMatchKey={setExpandedMatchKey}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
