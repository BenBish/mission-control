import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
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
import {
  AlertTriangle,
  AlertCircle,
  RefreshCw,
  Percent,
  Wrench,
  Users,
  TrendingUp,
} from "lucide-react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useProfile } from "@/app/profile-context";
import { apiFetch } from "@/lib/api-client";

interface FailureStats {
  success: boolean;
  totals: { totalFailures: number; failureRate: number };
  byTool: Array<{
    tool: string;
    failures: number;
    rate: number;
    lastFailed: string;
  }>;
  byActor: Array<{
    actor: string;
    failures: number;
    lastFailed: string;
  }>;
  daily: Array<{ date: string; failures: number; total: number }>;
  recentFailures: Array<{
    id: string;
    timestamp: string;
    actor: { id: string; displayName?: string; emoji?: string };
    toolName?: string;
    description: string;
    status: string;
  }>;
}

type DatePreset = "today" | "7d" | "30d" | "all";

function getDateRange(preset: DatePreset): {
  startTime?: string;
  endTime?: string;
} {
  if (preset === "all") return {};
  const now = new Date();
  const end = now.toISOString();
  if (preset === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return { startTime: start.toISOString(), endTime: end };
  }
  const days = preset === "7d" ? 7 : 30;
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return { startTime: start.toISOString(), endTime: end };
}

function formatRelativeTime(timestamp: string): string {
  const now = new Date();
  const date = new Date(timestamp);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export default function FailureAnalysis() {
  const { activeProfile, isSwitching } = useProfile();
  const navigate = useNavigate();
  const [data, setData] = useState<FailureStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [datePreset, setDatePreset] = useState<DatePreset>("30d");

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const range = getDateRange(datePreset);
      const params = new URLSearchParams();
      if (activeProfile?.id)
        params.set("profile", encodeURIComponent(activeProfile.id));
      if (range.startTime) params.set("startTime", range.startTime);
      if (range.endTime) params.set("endTime", range.endTime);

      const qs = params.toString() ? `?${params.toString()}` : "";
      const response = await apiFetch(`/api/failures${qs}`);
      if (!response.ok) throw new Error(`Failed: ${response.statusText}`);
      const json: FailureStats = await response.json();
      if (json.success) setData(json);
      else throw new Error("API returned unsuccessful response");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [activeProfile?.id, datePreset]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    fetchData();
  };

  if (isLoading || isSwitching)
    return (
      <div className="space-y-6">
        <PageHeader
          title="Failure Analysis"
          description="Identify what's breaking the most"
        />
        <Loading />
      </div>
    );

  if (error)
    return (
      <div className="space-y-6">
        <PageHeader
          title="Failure Analysis"
          description="Identify what's breaking the most"
        />
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-3 py-6">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <div>
              <p className="font-medium text-destructive">Error</p>
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );

  const topTool = data?.byTool[0];
  const topActor = data?.byActor[0];
  const chartToolData = (data?.byTool ?? []).slice(0, 10);

  const presets: { label: string; value: DatePreset }[] = [
    { label: "Today", value: "today" },
    { label: "Last 7 days", value: "7d" },
    { label: "Last 30 days", value: "30d" },
    { label: "All time", value: "all" },
  ];

  return (
    <div className="space-y-6">
      {/* Header + Controls */}
      <div className="flex items-center justify-between">
        <PageHeader
          title="Failure Analysis"
          description="Identify what's breaking the most"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={isRefreshing}
        >
          <RefreshCw
            className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      </div>

      {/* Date range presets */}
      <div className="flex gap-2">
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

      {/* Headline stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="overflow-hidden border-l-4 border-l-red-500">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Failures
            </CardTitle>
            <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/30">
              <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tracking-tight tabular-nums">
              {data?.totals.totalFailures ?? 0}
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden border-l-4 border-l-amber-500">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Failure Rate
            </CardTitle>
            <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
              <Percent className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tracking-tight tabular-nums">
              {data?.totals.failureRate ?? 0}%
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden border-l-4 border-l-purple-500">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Most Failing Tool
            </CardTitle>
            <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30">
              <Wrench className="h-4 w-4 text-purple-600 dark:text-purple-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold tracking-tight truncate">
              {topTool?.tool ?? "N/A"}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {topTool ? `${topTool.failures} failures` : "No failures"}
            </p>
          </CardContent>
        </Card>

        <Card className="overflow-hidden border-l-4 border-l-blue-500">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Most Failing Actor
            </CardTitle>
            <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
              <Users className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold tracking-tight truncate">
              {topActor?.actor ?? "N/A"}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {topActor ? `${topActor.failures} failures` : "No failures"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Top Failing Tools — Bar chart + table */}
      {chartToolData.length > 0 && (
        <Card className="shadow-sm">
          <CardHeader className="pb-4 border-b">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Wrench className="h-5 w-5 text-primary" />
              Top Failing Tools
            </CardTitle>
            <CardDescription>
              Tools with the highest failure counts
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="h-64 mb-6">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartToolData}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    className="stroke-muted"
                  />
                  <XAxis
                    dataKey="tool"
                    tick={{ fontSize: 12 }}
                    className="fill-muted-foreground"
                  />
                  <YAxis
                    tick={{ fontSize: 12 }}
                    className="fill-muted-foreground"
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                  />
                  <Bar
                    dataKey="failures"
                    fill="hsl(0, 72%, 51%)"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Tool
                    </th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Failures
                    </th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Failure Rate
                    </th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Last Failed
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.byTool ?? []).map((row) => (
                    <tr
                      key={row.tool}
                      className="border-b last:border-0 hover:bg-muted/40"
                    >
                      <td className="py-3 px-4 text-sm font-medium">
                        {row.tool}
                      </td>
                      <td className="py-3 px-4 text-sm text-right tabular-nums">
                        {row.failures.toLocaleString()}
                      </td>
                      <td className="py-3 px-4 text-sm text-right tabular-nums">
                        {row.rate}%
                      </td>
                      <td className="py-3 px-4 text-sm text-right text-muted-foreground">
                        {formatRelativeTime(row.lastFailed)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Top Failing Actors — table */}
      {(data?.byActor ?? []).length > 0 && (
        <Card className="shadow-sm">
          <CardHeader className="pb-4 border-b">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Users className="h-5 w-5 text-primary" />
              Top Failing Actors
            </CardTitle>
            <CardDescription>Actors with the most failures</CardDescription>
          </CardHeader>
          <CardContent className="pt-4 px-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Actor
                    </th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Failures
                    </th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Last Failed
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.byActor ?? []).map((row) => (
                    <tr
                      key={row.actor}
                      className="border-b last:border-0 hover:bg-muted/40"
                    >
                      <td className="py-3 px-4 text-sm font-medium">
                        {row.actor}
                      </td>
                      <td className="py-3 px-4 text-sm text-right tabular-nums">
                        {row.failures.toLocaleString()}
                      </td>
                      <td className="py-3 px-4 text-sm text-right text-muted-foreground">
                        {formatRelativeTime(row.lastFailed)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Failure Trend — Line chart */}
      {(data?.daily ?? []).length > 0 && (
        <Card className="shadow-sm">
          <CardHeader className="pb-4 border-b">
            <CardTitle className="flex items-center gap-2 text-lg">
              <TrendingUp className="h-5 w-5 text-primary" />
              Failure Trend
            </CardTitle>
            <CardDescription>Daily failure count over time</CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data?.daily ?? []}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    className="stroke-muted"
                  />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 12 }}
                    className="fill-muted-foreground"
                  />
                  <YAxis
                    tick={{ fontSize: 12 }}
                    className="fill-muted-foreground"
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="failures"
                    stroke="hsl(0, 72%, 51%)"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent Failures — table */}
      {(data?.recentFailures ?? []).length > 0 && (
        <Card className="shadow-sm">
          <CardHeader className="pb-4 border-b">
            <CardTitle className="flex items-center gap-2 text-lg">
              <AlertTriangle className="h-5 w-5 text-primary" />
              Recent Failures
            </CardTitle>
            <CardDescription>Last 20 failed activities</CardDescription>
          </CardHeader>
          <CardContent className="pt-4 px-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Time
                    </th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Actor
                    </th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Tool
                    </th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Description
                    </th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.recentFailures ?? []).map((activity) => (
                    <tr
                      key={activity.id}
                      className="border-b last:border-0 hover:bg-muted/40 cursor-pointer"
                      onClick={() => navigate(`/activities/${activity.id}`)}
                    >
                      <td className="py-3 px-4 text-sm text-muted-foreground whitespace-nowrap">
                        {formatRelativeTime(activity.timestamp)}
                      </td>
                      <td className="py-3 px-4 text-sm font-medium whitespace-nowrap">
                        {activity.actor.emoji ?? ""}{" "}
                        {activity.actor.displayName ?? activity.actor.id}
                      </td>
                      <td className="py-3 px-4 text-sm">
                        {activity.toolName ?? "—"}
                      </td>
                      <td className="py-3 px-4 text-sm max-w-xs truncate">
                        {activity.description}
                      </td>
                      <td className="py-3 px-4">
                        <Badge variant="destructive">failure</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {(data?.totals.totalFailures ?? 0) === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <div className="flex flex-col items-center gap-2">
              <AlertTriangle className="h-12 w-12 text-muted-foreground/30" />
              <p className="text-muted-foreground">No failures found.</p>
              <p className="text-sm text-muted-foreground">
                Failures will appear here when activities fail.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
