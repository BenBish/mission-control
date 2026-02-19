import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/_shared/PageHeader";
import { Loading } from "@/components/_shared/Loading";
import type { Activity } from "@/types/activity";
import {
  Activity as ActivityIcon,
  Users,
  TrendingUp,
  DollarSign,
  List,
  ArrowRight,
  AlertCircle,
} from "lucide-react";

interface StatsResponse {
  success: boolean;
  stats: {
    totalActivities: number;
    successCount: number;
    failureCount: number;
    successRate: number;
    totalCost: number;
    totalTokens: number;
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
  trend?: "up" | "down" | "neutral";
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<StatsResponse["stats"] | null>(null);
  const [recentActivities, setRecentActivities] = useState<Activity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      setError(null);
      try {
        // Fetch stats and recent activities in parallel
        const [statsRes, activitiesRes] = await Promise.all([
          fetch("http://localhost:3001/api/stats"),
          fetch("http://localhost:3001/api/activities?limit=5"),
        ]);

        if (!statsRes.ok) {
          throw new Error(`Failed to fetch stats: ${statsRes.statusText}`);
        }
        if (!activitiesRes.ok) {
          throw new Error(`Failed to fetch activities: ${activitiesRes.statusText}`);
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
  }, []);

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

  const getStatusColor = (status: string) => {
    switch (status) {
      case "success":
        return "text-green-600 bg-green-50 dark:bg-green-950";
      case "failure":
        return "text-red-600 bg-red-50 dark:bg-red-950";
      case "pending":
        return "text-amber-600 bg-amber-50 dark:bg-amber-950";
      case "partial":
        return "text-blue-600 bg-blue-50 dark:bg-blue-950";
      default:
        return "text-gray-600 bg-gray-50 dark:bg-gray-950";
    }
  };

  // Build stat cards from API data
  const statCards: StatCard[] = stats
    ? [
        {
          title: "Total Activities",
          value: stats.totalActivities?.toLocaleString() || "0",
          description: `${stats.successCount || 0} successful, ${stats.failureCount || 0} failed`,
          icon: ActivityIcon,
        },
        {
          title: "Total Cost",
          value: formatCost(stats.totalCost || 0),
          description: `${(stats.totalTokens || 0).toLocaleString()} tokens used`,
          icon: DollarSign,
        },
        {
          title: "Success Rate",
          value: `${(stats.successRate || 0).toFixed(1)}%`,
          description: "Overall success rate",
          icon: TrendingUp,
        },
        {
          title: "Active Actors",
          value: "—",
          description: "Actor stats coming soon",
          icon: Users,
        },
      ]
    : [
        {
          title: "Total Activities",
          value: "—",
          description: "Loading...",
          icon: ActivityIcon,
        },
        {
          title: "Total Cost",
          value: "—",
          description: "Loading...",
          icon: DollarSign,
        },
        {
          title: "Success Rate",
          value: "—",
          description: "Loading...",
          icon: TrendingUp,
        },
        {
          title: "Active Actors",
          value: "—",
          description: "Loading...",
          icon: Users,
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
              <p className="font-medium text-destructive">Error loading dashboard</p>
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Overview of your application metrics"
      />

      {/* Stats Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((stat) => (
          <Card key={stat.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
              <stat.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
              <p className="text-xs text-muted-foreground">{stat.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Recent Activity Card */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <List className="h-5 w-5" />
                Recent Activity
              </CardTitle>
              <CardDescription>Your most recent actions</CardDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/activities")}
            >
              View All
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent>
            {recentActivities.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No recent activity found.
              </p>
            ) : (
              <div className="space-y-4">
                {recentActivities.map((activity) => (
                  <div
                    key={activity.id}
                    className="flex items-center justify-between cursor-pointer hover:bg-muted/50 p-2 rounded-md transition-colors"
                    onClick={() => navigate(`/activities/${activity.id}`)}
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="flex flex-col min-w-0">
                        <p className="text-sm font-medium truncate">
                          {activity.description}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {activity.actor.type}: {activity.actor.id}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${getStatusColor(
                          activity.status
                        )}`}
                      >
                        {activity.status}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatTimestamp(activity.timestamp)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick Actions Card */}
        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>Frequently used actions</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3">
              <Button
                variant="outline"
                className="justify-start"
                onClick={() => navigate("/activities")}
              >
                <List className="mr-2 h-4 w-4" />
                View Activity Feed
              </Button>
              <Button
                variant="outline"
                className="justify-start"
                onClick={() => navigate("/costs")}
              >
                <DollarSign className="mr-2 h-4 w-4" />
                View Cost Breakdown
              </Button>
              <Button
                variant="outline"
                className="justify-start"
                onClick={() => window.open("http://localhost:3001/api/stream", "_blank")}
              >
                <ActivityIcon className="mr-2 h-4 w-4" />
                Open Real-time Stream
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
