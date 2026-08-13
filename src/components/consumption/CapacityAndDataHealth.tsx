import { useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loading } from "@/components/_shared/Loading";
import { DollarSign, Target, ChevronDown, Info } from "lucide-react";
import {
  acknowledgeSpendAlert,
  isCapacityAlert,
  type ProviderCredit,
  type ProviderStatus,
  type SpendInsights,
} from "@/lib/queries";
import { groupPlanUsageCredits } from "@/lib/plan-usage";
import { statusBadgeVariant } from "./helpers";
import { CreditSnapshotTile } from "./CreditSnapshotTile";

export function CapacityAndDataHealth({
  creditsLoading,
  planUsageCredits,
  walletCredits,
  providerStatus,
  spendInsights,
}: {
  creditsLoading: boolean;
  planUsageCredits: ProviderCredit[];
  walletCredits: ProviderCredit[];
  providerStatus: ProviderStatus[] | undefined;
  spendInsights: SpendInsights | undefined;
}) {
  const queryClient = useQueryClient();
  const capacityAlerts = (spendInsights?.alerts ?? []).filter(isCapacityAlert);
  return (
    <>
      {/* ── Plan usage & wallet (promoted; never mixed with spend) ─ */}
      <section
        id="capacity"
        className="space-y-4 min-w-0"
        data-testid="direct-api-capacity-section"
      >
        <div>
          <h3 className="text-sm font-semibold">Plan usage &amp; wallet</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Plan usage and wallet balances are <strong>not</strong> API org
            spend and are never mixed into Direct API Spend totals.
          </p>
        </div>

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
              Subscription / rate-limit windows (percent remaining). Each plan
              lists 5-hour and weekly slots; extras such as Opus weekly stay
              separate. Not wallet balance and not Direct API Spend. Expired
              windows are never green.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {creditsLoading ? (
              <Loading />
            ) : planUsageCredits.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No plan-usage windows yet. Codex, Claude Code, and Grok quotas
                appear after the desktop collector runs; Admin APIs do not
                expose subscription plan bars. Each subscription lists 5-hour
                and weekly slots (unavailable when the provider does not expose
                that window).
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
                    No fresh plan capacity available. Last observations are
                    expired or unavailable.
                  </p>
                )}
                <div className="space-y-4">
                  {groupPlanUsageCredits(planUsageCredits).map((group) => (
                    <div
                      key={group.provider}
                      className="space-y-2"
                      data-testid={`plan-usage-group-${group.provider}`}
                    >
                      <p className="text-xs font-medium text-muted-foreground">
                        {group.displayName}
                      </p>
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {group.credits.map((c) => (
                          <CreditSnapshotTile
                            key={`plan-${c.provider}-${c.label}-${c.asOf}`}
                            credit={c}
                          />
                        ))}
                      </div>
                    </div>
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
              Prepaid credit balance when providers expose it. Never mixed into
              Direct API Spend or session costs.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {creditsLoading ? (
              <Loading />
            ) : walletCredits.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No wallet snapshots yet. Configure provider keys and click Sync
                now.
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

        {capacityAlerts.length > 0 && (
          <Card className="shadow-sm min-w-0" data-testid="capacity-alerts">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                Plan &amp; wallet capacity alerts
              </CardTitle>
              <CardDescription>
                Subscription quota and prepaid-wallet remaining thresholds.
                These are not Direct API Spend alerts.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {capacityAlerts.slice(0, 12).map((a) => (
                <div
                  key={a.id}
                  className="rounded-md border px-3 py-2 text-sm min-w-0"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium break-words">{a.title}</p>
                    <Badge variant="secondary" className="text-xs">
                      {a.dataClass}
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
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </section>

      {/* ── Connectors & data health (collapsed by default) ─────── */}
      <details
        className="group rounded-lg border border-dashed bg-muted/20 min-w-0"
        data-testid="direct-api-capacity-health"
      >
        <summary className="cursor-pointer list-none flex flex-wrap items-center justify-between gap-2 px-4 py-3 select-none [&::-webkit-details-marker]:hidden">
          <div className="flex items-center gap-2 min-w-0">
            <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
            <span className="text-sm font-semibold">
              Connectors &amp; data health
            </span>
          </div>
          <span className="text-xs text-muted-foreground">
            Connector status · caveats · env vars
          </span>
        </summary>
        <div className="border-t px-4 py-4 space-y-4 min-w-0">
          <p className="text-xs text-muted-foreground">
            If OpenRouter BYOK and a direct provider (e.g. Anthropic) are both
            configured, the same spend can appear under both connectors.
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
                  title={p.lastError || p.limitation || p.notes || undefined}
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

          {spendInsights && (
            <p className="text-xs text-muted-foreground">
              {spendInsights.meta.notes[0]}{" "}
              {spendInsights.meta.partialMonth &&
                "Partial-month forecast uses current burn. "}
              Provider billing can lag finalization. Configure{" "}
              <code className="text-[11px]">OPENROUTER_API_KEY</code>,{" "}
              <code className="text-[11px]">ANTHROPIC_ADMIN_KEY</code>,{" "}
              <code className="text-[11px]">OPENAI_ADMIN_KEY</code>, and/or{" "}
              <code className="text-[11px]">XAI_API_KEY</code>.
            </p>
          )}
        </div>
      </details>
    </>
  );
}
