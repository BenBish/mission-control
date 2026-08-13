import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loading } from "@/components/_shared/Loading";
import { DollarSign, AlertTriangle, TrendingUp, Target } from "lucide-react";
import type { SpendInsights } from "@/lib/queries";
import {
  forecastUnavailableCaption,
  formatBurnRate,
  formatForecastMonthEnd,
} from "@/lib/spend-insights-display";

export function DirectApiOverview({
  insightsLoading,
  insightsError,
  spendInsights,
}: {
  insightsLoading: boolean;
  insightsError: Error | null;
  spendInsights: SpendInsights | undefined;
}) {
  const spendRateDisplay = useMemo(() => {
    if (!spendInsights) return null;
    return {
      burn: formatBurnRate({
        reliable: spendInsights.meta.forecastReliable,
        usdPerDay: spendInsights.burnRateUsdPerDay,
      }),
      forecast: formatForecastMonthEnd({
        reliable: spendInsights.meta.forecastReliable,
        pointUsd:
          spendInsights.forecast?.pointUsd ?? spendInsights.forecastMonthEndUsd,
      }),
      forecastCaption: forecastUnavailableCaption({
        reliable: spendInsights.meta.forecastReliable,
        hasNoSyncData: spendInsights.syncWarnings.some(
          (w) => w.reason === "no_sync_data",
        ),
        hasStaleOrErrorSync: spendInsights.syncWarnings.some(
          (w) => w.reason === "stale" || w.reason === "error",
        ),
      }),
    };
  }, [spendInsights]);

  return (
    <>
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
              <div className="space-y-2" data-testid="spend-risk-warnings">
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
                              Forecast is unreliable until a provider sync
                              succeeds. See Capacity &amp; data health for
                              connector status.
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
                                  ? new Date(w.lastSuccessAt).toLocaleString()
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
                    {spendInsights.meta.monthStart} → {spendInsights.meta.today}{" "}
                    ({spendInsights.meta.timezone})
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
                        ${(spendInsights.budget.remainingUsd ?? 0).toFixed(2)}
                      </div>
                      <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            (spendInsights.budget.consumedPct ?? 0) >= 100
                              ? "bg-destructive"
                              : (spendInsights.budget.consumedPct ?? 0) >= 80
                                ? "bg-amber-500"
                                : "bg-blue-500"
                          }`}
                          style={{
                            width: `${Math.min(100, spendInsights.budget.consumedPct ?? 0)}%`,
                          }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {(spendInsights.budget.consumedPct ?? 0).toFixed(1)}% of
                        ${spendInsights.budget.monthlyBudgetUsd.toFixed(2)}
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
                  <div
                    className={`text-2xl font-bold ${
                      spendRateDisplay?.burn.available
                        ? "tabular-nums"
                        : "text-muted-foreground"
                    }`}
                    data-testid="burn-rate-value"
                  >
                    {spendRateDisplay?.burn.primary ?? "—"}
                    {spendRateDisplay?.burn.available ? (
                      <span className="text-sm font-normal text-muted-foreground">
                        /day
                      </span>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {spendRateDisplay?.burn.available
                      ? `Day ${spendInsights.meta.daysElapsed} of ${spendInsights.meta.daysInMonth}`
                      : "Insufficient data"}
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
                    className={`text-2xl font-bold ${
                      spendRateDisplay?.forecast.available
                        ? "tabular-nums"
                        : "text-muted-foreground"
                    }`}
                    data-testid="forecast-month-end-value"
                  >
                    {spendRateDisplay?.forecast.primary ?? "—"}
                  </div>
                  {spendRateDisplay?.forecast.available &&
                  spendInsights.forecast ? (
                    <p className="text-xs text-muted-foreground mt-1 tabular-nums">
                      Range ${spendInsights.forecast.lowUsd.toFixed(2)}
                      –$
                      {spendInsights.forecast.highUsd.toFixed(2)} ·{" "}
                      {(spendInsights.forecast.confidence * 100).toFixed(0)}%
                      conf
                    </p>
                  ) : null}
                  <p className="text-xs text-muted-foreground mt-1">
                    {spendRateDisplay?.forecast.available
                      ? `${spendInsights.forecast?.method ?? spendInsights.meta.forecastMethod ?? "burn"} · lag ${spendInsights.meta.billingLagDays ?? spendInsights.forecast?.billingLagDays ?? 0}d`
                      : (spendRateDisplay?.forecastCaption ??
                        "Insufficient data")}
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
              <Card className="shadow-sm min-w-0" data-testid="fee-categories">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    Cost classes (kept separate)
                  </CardTitle>
                  <CardDescription>
                    Actual provider billing, agent-attributed session cost, and
                    estimates are never summed together
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
                        {spendInsights.feeCategories.agentAttributedCostUsd ==
                        null
                          ? "—"
                          : `$${spendInsights.feeCategories.agentAttributedCostUsd.toFixed(2)}`}
                      </p>
                    </div>
                    <div className="rounded-md border border-violet-500/40 bg-violet-500/5 px-3 py-2">
                      <p className="text-xs font-medium text-violet-800 dark:text-violet-300">
                        Est. cache savings
                      </p>
                      <p className="text-lg font-bold tabular-nums">
                        {spendInsights.feeCategories.estimatedCacheSavingsUsd ==
                        null
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
                        {spendInsights.feeCategories.failureWasteUsd == null
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
    </>
  );
}
