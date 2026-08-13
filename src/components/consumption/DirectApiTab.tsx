import { Link } from "react-router-dom";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Cloud, Info, RefreshCw } from "lucide-react";
import type {
  ProviderBreakdownRow,
  ProviderCredit,
  ProviderStatus,
  SpendInsights,
} from "@/lib/queries";
import type { ProviderTotals, UpdateConsumptionParams } from "./types";
import { DirectApiOverview } from "./DirectApiOverview";
import { DirectApiDrivers } from "./DirectApiDrivers";
import { DirectApiEfficiency } from "./DirectApiEfficiency";
import { ProviderBreakdown } from "./ProviderBreakdown";
import { CapacityAndDataHealth } from "./CapacityAndDataHealth";

export function DirectApiTab({
  selectedSourceId,
  agentScope,
  spendInsights,
  insightsLoading,
  insightsError,
  syncing,
  syncMessage,
  onProviderSync,
  rangeLabel,
  providerLoading,
  providerTotals,
  providerBreakdown,
  updateParams,
  creditsLoading,
  planUsageCredits,
  walletCredits,
  providerStatus,
}: {
  selectedSourceId: string | undefined;
  agentScope: string;
  spendInsights: SpendInsights | undefined;
  insightsLoading: boolean;
  insightsError: Error | null;
  syncing: boolean;
  syncMessage: string | null;
  onProviderSync: () => void;
  rangeLabel: string;
  providerLoading: boolean;
  providerTotals: ProviderTotals;
  providerBreakdown: ProviderBreakdownRow[] | undefined;
  updateParams: UpdateConsumptionParams;
  creditsLoading: boolean;
  planUsageCredits: ProviderCredit[];
  walletCredits: ProviderCredit[];
  providerStatus: ProviderStatus[] | undefined;
}) {
  return (
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
              <strong>API org spend</strong> from provider Admin billing APIs —
              not agent session logs, plan usage windows, or wallet balances.
              Budget/forecast: calendar month (
              {spendInsights?.meta.timezone ?? "UTC"}).
            </CardDescription>
            {selectedSourceId && (
              <p className="text-xs text-amber-700 dark:text-amber-400 flex items-start gap-1.5">
                <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                Source filter “{agentScope}” does not apply here — provider
                billing is account-wide and cannot be scoped to a single agent
                source.
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
              onClick={() => void onProviderSync()}
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
        {/* BSH-98: decision content first — Overview → Drivers → Attribution → Capacity */}
        <DirectApiOverview
          insightsLoading={insightsLoading}
          insightsError={insightsError}
          spendInsights={spendInsights}
        />
        <DirectApiDrivers
          insightsLoading={insightsLoading}
          spendInsights={spendInsights}
        />
        <DirectApiEfficiency spendInsights={spendInsights} />
        <ProviderBreakdown
          rangeLabel={rangeLabel}
          providerLoading={providerLoading}
          providerTotals={providerTotals}
          providerBreakdown={providerBreakdown}
          updateParams={updateParams}
        />
        <CapacityAndDataHealth
          creditsLoading={creditsLoading}
          planUsageCredits={planUsageCredits}
          walletCredits={walletCredits}
          providerStatus={providerStatus}
          spendInsights={spendInsights}
        />
      </CardContent>
    </Card>
  );
}
