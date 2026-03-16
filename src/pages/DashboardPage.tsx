import { useState, useEffect, useCallback, useRef } from "react";
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
import { Separator } from "@/components/ui/separator";
import type { Activity } from "@/types/activity";
import { useProfile } from "@/app/profile-context";
import { apiFetch } from "@/lib/api-client";
import { useSSE } from "@/hooks/useSSE";
import { useDailyStats } from "@/hooks/useDailyStats";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  Activity as ActivityIcon,
  Users,
  TrendingUp,
  DollarSign,
  List,
  ArrowRight,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Clock,
  BarChart3,
} from "lucide-react";

interface StatsResponse {
  success: boolean;
  stats: {
    activities: number;
    sessions: number;
    successCount: number;
    failureCount: number;
    successRate: number;
    totalCost: number;
    totalTokens: number;
    activeActors: number;
    totalAgents: number;
  };
}

interface ActivitiesResponse {
  success: boolean;
  count: number;
  activities: Activity[];
}

interface StatCard {
  title: string;
  value: string;
  description: string;
  icon: typeof ActivityIcon;
  color: string;
  bgColor: string;
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { profileId } = useProfile();
  const [stats, setStats] = useState<StatsResponse["stats"] | null>(null);
  const [recentActivities, setRecentActivities] = useState<Activity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const statsRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dailyRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const {
    data: dailyStats,
    loading: dailyLoading,
    refetch: refetchDaily,
  } = useDailyStats(profileId);

  const refreshStats = useCallback(() => {
    if (statsRefreshTimer.current) clearTimeout(statsRefreshTimer.current);
    statsRefreshTimer.current = setTimeout(async () => {
      try {
        const res = await apiFetch(
          `/api/stats?profile=${encodeURIComponent(profileId)}`,
        );
        if (res.ok) {
          const data: StatsResponse = await res.json();
          if (data.success) setStats(data.stats);
        }
      } catch {
        // silent — don't show error for background refresh
      }
    }, 2000);
  }, [profileId]);

  // Handle real-time activity events from the profile-scoped SSE stream
  const onActivity = useCallback(
    (activity: Activity) => {
      setRecentActivities((prev) => {
        // Prepend new activity, deduplicate, and keep only the 5 most recent
        const exists = prev.some((a) => a.id === activity.id);
        const updated = exists
          ? prev.map((a) => (a.id === activity.id ? activity : a))
          : [activity, ...prev];
        return updated.slice(0, 5);
      });
      refreshStats();
      // Debounce daily stats refresh on SSE events
      if (dailyRefreshTimer.current) clearTimeout(dailyRefreshTimer.current);
      dailyRefreshTimer.current = setTimeout(() => {
        refetchDaily();
      }, 2000);
    },
    [refreshStats, refetchDaily],
  );

  useEffect(() => {
    return () => {
      if (statsRefreshTimer.current) clearTimeout(statsRefreshTimer.current);
      if (dailyRefreshTimer.current) clearTimeout(dailyRefreshTimer.current);
    };
  }, []);

  useSSE(profileId, { onActivity });

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const profileParam = `profile=${encodeURIComponent(profileId)}`;
        // Fetch stats and recent activities in parallel, scoped to profile
        const [statsRes, activitiesRes] = await Promise.all([
          apiFetch(`/api/stats?${profileParam}`),
          apiFetch(`/api/activities?limit=5&${profileParam}`),
        ]);

        if (!statsRes.ok) {
          throw new Error(`Failed to fetch stats: ${statsRes.statusText}`);
        }
        if (!activitiesRes.ok) {
          throw new Error(
            `Failed to fetch activities: ${activitiesRes.statusText}`,
          );
        }

        const statsData: StatsResponse = await statsRes.json();
        const activitiesData: ActivitiesResponse = await activitiesRes.json();

        if (statsData.success) {
          setStats(statsData.stats);
        }
        if (activitiesData.success) {
          setRecentActivities(activitiesData.activities);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error occurred");
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [profileId]);

  const formatCost = (cost: number) => {
    return `$${cost.toFixed(4)}`;
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "success":
        return (
          <Badge
            variant="outline"
            className="bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800"
          >
            <CheckCircle2 className="h-3 w-3 mr-1" />
            success
          </Badge>
        );
      case "failure":
        return (
          <Badge
            variant="outline"
            className="bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-800"
          >
            <XCircle className="h-3 w-3 mr-1" />
            failure
          </Badge>
        );
      case "pending":
        return (
          <Badge
            variant="outline"
            className="bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800"
          >
            <Clock className="h-3 w-3 mr-1" />
            pending
          </Badge>
        );
      case "partial":
        return (
          <Badge
            variant="outline"
            className="bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-800"
          >
            <BarChart3 className="h-3 w-3 mr-1" />
            partial
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getSuccessRateColor = (rate: number) => {
    if (rate >= 90) return "text-emerald-600 dark:text-emerald-400";
    if (rate >= 70) return "text-amber-600 dark:text-amber-400";
    return "text-red-600 dark:text-red-400";
  };

  const getSuccessRateBg = (rate: number) => {
    if (rate >= 90) return "bg-emerald-500/10 dark:bg-emerald-500/20";
    if (rate >= 70) return "bg-amber-500/10 dark:bg-amber-500/20";
    return "bg-red-500/10 dark:bg-red-500/20";
  };

  // Build stat cards from API data
  const statCards: StatCard[] = stats
    ? [
        {
          title: "Total Activities",
          value: stats.activities?.toLocaleString() || "0",
          description: `${stats.successCount || 0} successful, ${stats.failureCount || 0} failed`,
          icon: ActivityIcon,
          color: "text-blue-600 dark:text-blue-400",
          bgColor: "bg-blue-500/10 dark:bg-blue-500/20",
        },
        {
          title: "Total Cost",
          value: formatCost(stats.totalCost || 0),
          description: `${(stats.totalTokens || 0).toLocaleString()} tokens used`,
          icon: DollarSign,
          color: "text-violet-600 dark:text-violet-400",
          bgColor: "bg-violet-500/10 dark:bg-violet-500/20",
        },
        {
          title: "Success Rate",
          value: `${(stats.successRate || 0).toFixed(1)}%`,
          description:
            stats.successRate >= 90
              ? "Excellent performance"
              : stats.successRate >= 70
                ? "Good performance"
                : "Needs attention",
          icon: TrendingUp,
          color: getSuccessRateColor(stats.successRate || 0),
          bgColor: getSuccessRateBg(stats.successRate || 0),
        },
        {
          title: "Active Actors",
          value: String(stats.activeActors),
          description: `${stats.activeActors} of ${stats.totalAgents} agents active`,
          icon: Users,
          color: "text-cyan-600 dark:text-cyan-400",
          bgColor: "bg-cyan-500/10 dark:bg-cyan-500/20",
        },
      ]
    : [
        {
          title: "Total Activities",
          value: "—",
          description: "Loading...",
          icon: ActivityIcon,
          color: "text-muted-foreground",
          bgColor: "bg-muted",
        },
        {
          title: "Total Cost",
          value: "—",
          description: "Loading...",
          icon: DollarSign,
          color: "text-muted-foreground",
          bgColor: "bg-muted",
        },
        {
          title: "Success Rate",
          value: "—",
          description: "Loading...",
          icon: TrendingUp,
          color: "text-muted-foreground",
          bgColor: "bg-muted",
        },
        {
          title: "Active Actors",
          value: "—",
          description: "Loading...",
          icon: Users,
          color: "text-muted-foreground",
          bgColor: "bg-muted",
        },
      ];

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Dashboard"
          description="Overview of your application metrics"
        />
        <Loading />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Dashboard"
          description="Overview of your application metrics"
        />
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-3 py-6">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <div>
              <p className="font-medium text-destructive">
                Error loading dashboard
              </p>
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Dashboard"
        description="Overview of your application metrics"
      />

      {/* Stats Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((stat) => (
          <Card
            key={stat.title}
            className="shadow-sm hover:shadow-md transition-shadow"
          >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {stat.title}
              </CardTitle>
              <div className={`p-2 rounded-lg ${stat.bgColor}`}>
                <stat.icon className={`h-4 w-4 ${stat.color}`} />
              </div>
            </CardHeader>
            <CardContent>
              <div
                className={`text-3xl font-bold tracking-tight ${stat.title === "Success Rate" ? stat.color : ""}`}
              >
                {stat.value}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {stat.description}
              </p>
            </CardContent>
          </Card>
        ))}
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
            {recentActivities.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <ActivityIcon className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No recent activity found.</p>
              </div>
            ) : (
              <div className="space-y-1">
                {recentActivities.map((activity) => (
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
                        <p className="text-xs text-muted-foreground">
                          <span>
                            {activity.actor.emoji && (
                              <span className="mr-0.5">
                                {activity.actor.emoji}
                              </span>
                            )}
                            {activity.actor.displayName || activity.actor.id}
                          </span>
                          <span className="mx-1">·</span>
                          <span className="capitalize">
                            {activity.actor.type}
                          </span>
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      {getStatusBadge(activity.status)}
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatTimestamp(activity.timestamp)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Trend Charts */}
        <div className="lg:col-span-3 space-y-6">
          {/* Activity Volume Chart */}
          <Card className="shadow-sm">
            <CardHeader className="pb-4">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-primary/10">
                  <TrendingUp className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-lg">Activity Volume</CardTitle>
                  <CardDescription>Daily activity trend</CardDescription>
                </div>
              </div>
            </CardHeader>
            <Separator />
            <CardContent className="pt-4">
              {dailyLoading ? (
                <div className="h-64 bg-muted animate-pulse rounded" />
              ) : dailyStats.length === 0 ? (
                <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
                  No activity data yet
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={256}>
                  <AreaChart data={dailyStats}>
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
                      interval={6}
                      className="text-muted-foreground"
                    />
                    <YAxis
                      tick={{ fontSize: 12 }}
                      className="text-muted-foreground"
                    />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        const row = payload[0]?.payload;
                        return (
                          <div className="rounded-lg border bg-background p-3 shadow-md text-sm">
                            <p className="font-medium mb-1">{label}</p>
                            <p className="text-emerald-600">
                              Success: {row?.successCount ?? 0}
                            </p>
                            <p className="text-red-600">
                              Failure: {row?.failureCount ?? 0}
                            </p>
                            <p className="text-muted-foreground">
                              Rate: {row?.successRate ?? 0}%
                            </p>
                          </div>
                        );
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="successCount"
                      stroke="#10b981"
                      fill="#10b981"
                      fillOpacity={0.15}
                      name="Success"
                    />
                    <Area
                      type="monotone"
                      dataKey="failureCount"
                      stroke="#ef4444"
                      fill="#ef4444"
                      fillOpacity={0.15}
                      name="Failure"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Daily Cost Chart */}
          <Card className="shadow-sm">
            <CardHeader className="pb-4">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-violet-500/10">
                  <DollarSign className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                </div>
                <div>
                  <CardTitle className="text-lg">Daily Cost</CardTitle>
                  <CardDescription>Cost trend over time</CardDescription>
                </div>
              </div>
            </CardHeader>
            <Separator />
            <CardContent className="pt-4">
              {dailyLoading ? (
                <div className="h-48 bg-muted animate-pulse rounded" />
              ) : dailyStats.length === 0 ? (
                <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
                  No activity data yet
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={192}>
                  <BarChart data={dailyStats}>
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
                      interval={6}
                      className="text-muted-foreground"
                    />
                    <YAxis
                      tick={{ fontSize: 12 }}
                      tickFormatter={(value: number) => `$${value.toFixed(4)}`}
                      className="text-muted-foreground"
                    />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        const row = payload[0]?.payload;
                        return (
                          <div className="rounded-lg border bg-background p-3 shadow-md text-sm">
                            <p className="font-medium mb-1">{label}</p>
                            <p className="text-violet-600">
                              ${(row?.cost ?? 0).toFixed(4)}
                            </p>
                            <p className="text-muted-foreground">
                              {(row?.tokens ?? 0).toLocaleString()} tokens
                            </p>
                          </div>
                        );
                      }}
                    />
                    <Bar dataKey="cost" fill="#8b5cf6" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
