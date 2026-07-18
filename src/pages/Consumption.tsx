import { useMemo, useState } from "react";
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
import { PageHeader } from "@/components/_shared/PageHeader";
import { Loading } from "@/components/_shared/Loading";
import { DollarSign, Zap, Cpu, Calendar, RefreshCw, Cloud } from "lucide-react";
import { useSourceFilter } from "@/app/source-context";
import {
  useConsumption,
  useProviderBreakdown,
  useProviderStatus,
  triggerProviderSync,
} from "@/lib/queries";

type DatePreset = "today" | "7d" | "30d" | "all";
type Unit = "tokens" | "compute" | "usd";

function getSince(preset: DatePreset): string | undefined {
  if (preset === "all") return undefined;
  const now = new Date();
  if (preset === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return start.toISOString();
  }
  const days = preset === "7d" ? 7 : 30;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
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
  const { selectedSourceId } = useSourceFilter();
  const [datePreset, setDatePreset] = useState<DatePreset>("30d");
  const [unit, setUnit] = useState<Unit>("tokens");
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // Memoized on datePreset only — getSince() reads the current time, so
  // calling it directly in the hook args would produce a new `since` value
  // (and therefore a new query key) on every render.
  const since = useMemo(() => getSince(datePreset), [datePreset]);

  const {
    data: rows,
    isLoading,
    error,
  } = useConsumption({ since, sourceId: selectedSourceId });

  const { data: providerStatus } = useProviderStatus();
  const { data: providerBreakdown } = useProviderBreakdown({ since });

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

  const presets: { label: string; value: DatePreset }[] = [
    { label: "Today", value: "today" },
    { label: "Last 7 days", value: "7d" },
    { label: "Last 30 days", value: "30d" },
    { label: "All time", value: "all" },
  ];

  const units: { label: string; value: Unit }[] = [
    { label: "Tokens", value: "tokens" },
    { label: "Compute time", value: "compute" },
    { label: "USD", value: "usd" },
  ];

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
    } catch (err) {
      setSyncMessage(
        err instanceof Error ? err.message : "Provider sync failed",
      );
    } finally {
      setSyncing(false);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Consumption"
          description="Token, compute, and cost usage by source"
        />
        <Loading />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Consumption"
          description="Token, compute, and cost usage by source"
        />
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
      <PageHeader
        title="Consumption"
        description="Token, compute, and cost usage by source"
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {presets.map((p) => (
            <Button
              key={p.value}
              variant={datePreset === p.value ? "default" : "outline"}
              size="sm"
              onClick={() => setDatePreset(p.value)}
            >
              {p.label}
            </Button>
          ))}
        </div>
        <div className="flex gap-2">
          {units.map((u) => (
            <Button
              key={u.value}
              variant={unit === u.value ? "default" : "outline"}
              size="sm"
              onClick={() => setUnit(u.value)}
            >
              {u.label}
            </Button>
          ))}
        </div>
      </div>
      <p className="text-sm text-muted-foreground flex items-center gap-1.5">
        <Calendar className="h-3.5 w-3.5" />
        Showing: {presets.find((p) => p.value === datePreset)?.label}
      </p>

      {unit === "usd" && !totals.hasCost ? (
        <Card>
          <CardContent className="py-12 text-center">
            <div className="flex flex-col items-center gap-2">
              <DollarSign className="h-12 w-12 text-muted-foreground/30" />
              <p className="text-muted-foreground">
                No billable usage — all current sources are subscription or
                local.
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
                  Grouped over the selected date range
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
                            <span className="font-medium">{row.sourceId}</span>
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
                  No consumption data for this range yet.
                </p>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Provider API billing — distinct from session-log / agent sources above */}
      <Card className="shadow-sm border-dashed">
        <CardHeader className="pb-4 border-b">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <Cloud className="h-5 w-5" />
                Provider API costs
              </CardTitle>
              <CardDescription className="mt-1">
                Account-level usage from OpenRouter, Anthropic, OpenAI, and xAI
                billing APIs — separate from agent session logs above. Not
                double-counted with source totals. If OpenRouter BYOK and a
                direct provider (e.g. Anthropic) are both configured, the same
                spend can appear under both connectors.
              </CardDescription>
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
              {syncing ? "Syncing…" : "Sync now"}
            </Button>
          </div>
          {syncMessage && (
            <p className="text-xs text-muted-foreground mt-2 font-mono">
              {syncMessage}
            </p>
          )}
        </CardHeader>
        <CardContent className="pt-4 space-y-4">
          {providerStatus && providerStatus.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {providerStatus.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm"
                  title={p.lastError || p.notes || undefined}
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

          {providerTotals.hasCost || providerTotals.tokens > 0 ? (
            <>
              <div className="flex flex-wrap gap-4 text-sm">
                <span className="tabular-nums">
                  Tokens:{" "}
                  <strong>{providerTotals.tokens.toLocaleString()}</strong>
                </span>
                {providerTotals.hasCost && (
                  <span className="tabular-nums">
                    Cost: <strong>${providerTotals.cost.toFixed(4)}</strong>
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
            <p className="text-sm text-muted-foreground">
              No provider API usage for this range. Configure{" "}
              <code className="text-xs">OPENROUTER_API_KEY</code>,{" "}
              <code className="text-xs">ANTHROPIC_ADMIN_KEY</code>,{" "}
              <code className="text-xs">OPENAI_ADMIN_KEY</code>, and/or{" "}
              <code className="text-xs">XAI_API_KEY</code>, then click Sync now.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
