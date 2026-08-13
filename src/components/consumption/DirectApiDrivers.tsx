import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Loading } from "@/components/_shared/Loading";
import { AlertTriangle } from "lucide-react";
import type { SpendInsights } from "@/lib/queries";
import { DailySpendTrendChart } from "./DailySpendTrendChart";

export function DirectApiDrivers({
  insightsLoading,
  spendInsights,
}: {
  insightsLoading: boolean;
  spendInsights: SpendInsights | undefined;
}) {
  return (
    <>
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
                <CardTitle className="text-base">Daily spend (MTD)</CardTitle>
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
                  <DailySpendTrendChart points={spendInsights.dailyTrend} />
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
                      <p className="font-medium break-words">{a.message}</p>
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
    </>
  );
}
