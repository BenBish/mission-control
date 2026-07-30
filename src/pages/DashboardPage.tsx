import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
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
import { Separator } from "@/components/ui/separator";
import type { Activity } from "@/types/activity";
import { actorIcon, actorTypeLabel } from "@/lib/actor-display";
import { useSSE } from "@/hooks/useSSE";
import { useNow } from "@/hooks/useNow";
import { useFilterableSourceId, useSourceFilter } from "@/app/source-context";
import { scopePhrase } from "@/config/sourceScope";
import {
  useActivityList,
  useConsumption,
  useFailures,
  useProviderBreakdown,
  useSources,
} from "@/lib/queries";
import { failureStatusScopeLabel } from "@/types/failures";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  Activity as ActivityIcon,
  Zap,
  List,
  ArrowRight,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  DollarSign,
} from "lucide-react";

const STATUS_DOT: Record<string, string> = {
  ok: "bg-green-500",
  off: "bg-muted-foreground/40",
  error: "bg-red-500",
  unknown: "bg-amber-500",
};

export default function DashboardPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { sources: filterSources } = useSourceFilter();
  const selectedSourceId = useFilterableSourceId();
  const scopeLabel = scopePhrase(selectedSourceId, filterSources);

  const { data: sources, isLoading: sourcesLoading } = useSources();
  const { data: activities, isLoading: activitiesLoading } = useActivityList({
    limit: 5,
    sourceId: selectedSourceId,
  });
  const { data: failuresData } = useFailures({
    limit: 5,
    sourceId: selectedSourceId,
  });
  const failures = failuresData?.failures;
  const failureSummary = failuresData?.summary;
  const failureScopeLabel = failureStatusScopeLabel(failureSummary);
  const nowMs = useNow();
  // List preview matches the 24h card — never mix older rows into the metric.
  const failuresLast24h = useMemo(() => {
    if (!failures?.length) return [];
    const cutoffMs = nowMs - 24 * 60 * 60 * 1000;
    return failures
      .filter((f) => {
        const t = new Date(f.timestamp).getTime();
        return !Number.isNaN(t) && t >= cutoffMs;
      })
      .slice(0, 5);
  }, [failures, nowMs]);
  const { data: consumption, isLoading: consumptionLoading } = useConsumption({
    sourceId: selectedSourceId,
  });

  // Last 30 days of provider API billing for the homepage spend card.
  // useState initializer runs once (impure clock OK there; not during render).
  const [providerSince] = useState(() =>
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
  );
  const { data: providerBreakdown, isPending: providerSpendPending } =
    useProviderBreakdown({
      since: providerSince,
    });

  useSSE({
    onActivity: () => {
      // Prefix invalidation: only active query keys (incl. sourceId) refetch.
      queryClient.invalidateQueries({ queryKey: ["activities"] });
      queryClient.invalidateQueries({ queryKey: ["consumption"] });
      queryClient.invalidateQueries({ queryKey: ["failures"] });
      queryClient.invalidateQueries({ queryKey: ["provider-breakdown"] });
    },
  });

  const tokensToday = useMemo(() => {
    if (!consumption) return 0;
    const today = new Date().toISOString().slice(0, 10);
    return consumption
      .filter((row) => row.day === today)
      .reduce((sum, row) => sum + row.input_tokens + row.output_tokens, 0);
  }, [consumption]);

  const providerSpend30d = useMemo(() => {
    if (!providerBreakdown) return { cost: 0, hasCost: false };
    return providerBreakdown.reduce(
      (acc, row) => ({
        cost: acc.cost + (row.cost_usd ?? 0),
        hasCost: acc.hasCost || row.cost_usd != null,
      }),
      { cost: 0, hasCost: false },
    );
  }, [providerBreakdown]);

  const dailyTokens = useMemo(() => {
    if (!consumption) return [];
    const byDay = new Map<string, number>();
    for (const row of consumption) {
      byDay.set(
        row.day,
        (byDay.get(row.day) ?? 0) + row.input_tokens + row.output_tokens,
      );
    }
    return Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, tokens]) => ({ date, tokens }));
  }, [consumption]);

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const diffMs = new Date().getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const isLoading = sourcesLoading && activitiesLoading && consumptionLoading;
  const pageDescription = `Overview of AI usage ${scopeLabel}`;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Dashboard" description={pageDescription} />
        <Loading />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader title="Dashboard" description={pageDescription} />

      {/* Stats Grid */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Tokens Today
            </CardTitle>
            <div className="p-2 rounded-lg bg-blue-500/10 dark:bg-blue-500/20">
              <Zap className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tracking-tight">
              {tokensToday.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              input + output, {scopeLabel}
            </p>
          </CardContent>
        </Card>

        <Link
          to="/consumption?view=direct-api&range=30d"
          className="block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-label="API Spend last 30 days — view Direct API Spend"
        >
          <Card className="shadow-sm h-full transition-colors hover:bg-muted/40">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                API Spend (30d)
              </CardTitle>
              <div className="p-2 rounded-lg bg-emerald-500/10 dark:bg-emerald-500/20">
                <DollarSign className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold tracking-tight tabular-nums">
                {providerSpendPending
                  ? "…"
                  : providerSpend30d.hasCost
                    ? `$${providerSpend30d.cost.toFixed(4)}`
                    : "$0.0000"}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Direct provider billing · account-wide · View spend
              </p>
            </CardContent>
          </Card>
        </Link>

        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Failures (24h)
            </CardTitle>
            <div className="p-2 rounded-lg bg-red-500/10 dark:bg-red-500/20">
              <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tracking-tight">
              {(failureSummary?.last24Hours ?? 0).toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Last 24 hours · {failureScopeLabel}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              <button
                className="hover:underline"
                onClick={() => navigate("/failures")}
              >
                View failures
              </button>
              {failureSummary && failureSummary.openRuntimeEvents > 0 && (
                <span>
                  {" "}
                  · {failureSummary.openRuntimeEvents.toLocaleString()} open
                  runtime
                </span>
              )}
            </p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Source Health
            </CardTitle>
            <CardDescription className="text-xs">
              All sources (fleet-wide)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {(sources ?? []).map((source) => {
                const status = source.instances[0]?.status ?? "unknown";
                // Opacity is emphasis only — health stays fleet-wide, not filtered.
                const isSelected =
                  !selectedSourceId || source.id === selectedSourceId;
                return (
                  <Badge
                    key={source.id}
                    variant="outline"
                    className={`gap-1.5 font-normal ${
                      isSelected ? "" : "opacity-50"
                    }`}
                  >
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${STATUS_DOT[status] ?? STATUS_DOT.unknown}`}
                    />
                    {source.name}
                  </Badge>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-7">
        {/* Recent Activity Card */}
        <Card className="lg:col-span-4 shadow-sm">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-primary/10">
                  <List className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-lg">Recent Activity</CardTitle>
                  <CardDescription>Your most recent actions</CardDescription>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate("/activities")}
                className="gap-1"
              >
                View All
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <Separator />
          <CardContent className="pt-4">
            {!activities || activities.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <ActivityIcon className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No recent activity found.</p>
              </div>
            ) : (
              <div className="space-y-1">
                {activities.map((activity: Activity) => {
                  const Icon = actorIcon(activity.actor.type);
                  return (
                    <div
                      key={activity.id}
                      className="group flex items-center justify-between p-3 rounded-lg cursor-pointer hover:bg-muted/60 transition-colors"
                      onClick={() => navigate(`/activities/${activity.id}`)}
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        <div
                          className={`p-1.5 rounded-md ${
                            activity.status === "success"
                              ? "bg-emerald-100 dark:bg-emerald-900/30"
                              : activity.status === "failure"
                                ? "bg-red-100 dark:bg-red-900/30"
                                : "bg-amber-100 dark:bg-amber-900/30"
                          }`}
                        >
                          {activity.status === "success" ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                          ) : activity.status === "failure" ? (
                            <XCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
                          ) : (
                            <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                          )}
                        </div>
                        <div className="flex flex-col min-w-0">
                          <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                            {activity.description}
                          </p>
                          <p className="text-xs text-muted-foreground flex items-center gap-1">
                            <Icon className="h-3 w-3" />
                            {activity.actor.id}
                            <span className="mx-0.5">·</span>
                            {actorTypeLabel(activity.actor.type)}
                          </p>
                        </div>
                      </div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0">
                        {formatTimestamp(activity.timestamp)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Token trend chart */}
        <div className="lg:col-span-3">
          <Card className="shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg">Token Usage</CardTitle>
              <CardDescription>Daily total {scopeLabel}</CardDescription>
            </CardHeader>
            <Separator />
            <CardContent className="pt-4">
              {dailyTokens.length === 0 ? (
                <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
                  No token usage yet
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={256}>
                  <AreaChart data={dailyTokens}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      className="stroke-border"
                    />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 12 }}
                      tickFormatter={(value: string) => {
                        const d = new Date(value + "T00:00:00");
                        return `${d.getMonth() + 1}/${d.getDate()}`;
                      }}
                      className="text-muted-foreground"
                    />
                    <YAxis
                      tick={{ fontSize: 12 }}
                      className="text-muted-foreground"
                    />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        return (
                          <div className="rounded-lg border bg-background p-3 shadow-md text-sm">
                            <p className="font-medium mb-1">{label}</p>
                            <p className="text-blue-600">
                              {(payload[0]?.value as number)?.toLocaleString()}{" "}
                              tokens
                            </p>
                          </div>
                        );
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="tokens"
                      stroke="#3b82f6"
                      fill="#3b82f6"
                      fillOpacity={0.15}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {failuresLast24h.length > 0 && (
        <Card className="shadow-sm border-l-4 border-l-red-500">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
              Failures in last 24 hours
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {failuresLast24h.map((f) => (
              <div
                key={`${f.kind}:${f.id}`}
                className="flex items-center justify-between text-sm py-1"
              >
                <span className="truncate">{f.summary}</span>
                <span className="text-xs text-muted-foreground whitespace-nowrap ml-3">
                  {formatTimestamp(f.timestamp)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
