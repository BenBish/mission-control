import { Link } from "react-router-dom";
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
import { acknowledgeSpendAlert, type SpendInsights } from "@/lib/queries";

export function DirectApiEfficiency({
  spendInsights,
}: {
  spendInsights: SpendInsights | undefined;
}) {
  const queryClient = useQueryClient();
  if (!spendInsights) return null;
  return (
    <>
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
                Each item links evidence to estimated impact — classes stay
                labeled
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {spendInsights.recommendations.slice(0, 8).map((rec, i) => (
                <div
                  key={`${rec.kind}-${i}`}
                  className="rounded-md border px-3 py-2 text-sm min-w-0"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium break-words">{rec.title}</p>
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
                        : JSON.stringify(rec.evidence).slice(0, 160)}
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
                Separate from actual provider billing — cost/session when
                attribution exists
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
              <CardTitle className="text-base">Scoped budgets</CardTitle>
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
                <div key={b.id} className="rounded-md border px-3 py-2 text-sm">
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
          <Card className="shadow-sm min-w-0" data-testid="spend-alerts">
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
                    <p className="font-medium break-words">{a.title}</p>
                    <Badge variant="secondary" className="text-xs">
                      {a.kind}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      {a.deliveryState}
                    </Badge>
                    <Badge
                      variant={
                        a.severity === "critical" ? "destructive" : "secondary"
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
                          void acknowledgeSpendAlert(a.id).then(() => {
                            void queryClient.invalidateQueries({
                              queryKey: ["provider-spend-insights"],
                            });
                          });
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
                      {a.deliveredAt ? ` · delivered ${a.deliveredAt}` : ""}
                    </p>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </section>
    </>
  );
}
