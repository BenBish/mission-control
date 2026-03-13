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
import type { Activity } from "@/types/activity";
import { useProfile } from "@/app/profile-context";
import { useSSE } from "@/hooks/useSSE";
import { apiFetch } from "@/lib/api-client";
import {
  List,
  ArrowRight,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Clock,
  BarChart3,
} from "lucide-react";

interface ActivitiesResponse {
  success: boolean;
  count: number;
  activities: Activity[];
}

export default function ActivityFeed() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { profileId } = useProfile();

  // Handle real-time activity events from the profile-scoped SSE stream
  const onActivity = useCallback((activity: Activity) => {
    setActivities((prev) => {
      const exists = prev.some((a) => a.id === activity.id);
      const updated = exists
        ? prev.map((a) => (a.id === activity.id ? activity : a))
        : [activity, ...prev];
      // Keep sorted newest-first and cap at 100
      return updated
        .sort(
          (a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
        )
        .slice(0, 100);
    });
  }, []);

  useSSE(profileId, { onActivity });

  useEffect(() => {
    const fetchActivities = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await apiFetch(
          `/api/activities?limit=100&profile=${encodeURIComponent(profileId)}`,
        );
        if (!response.ok) {
          throw new Error(`Failed to fetch activities: ${response.statusText}`);
        }
        const data: ActivitiesResponse = await response.json();
        if (data.success) {
          setActivities(data.activities);
        } else {
          throw new Error("API returned unsuccessful response");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error occurred");
      } finally {
        setIsLoading(false);
      }
    };

    fetchActivities();
  }, [profileId]);

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

  const formatCost = (cost?: { usd: number }) => {
    if (!cost) return "$0.0000";
    return `$${cost.usd.toFixed(4)}`;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "success":
        return (
          <Badge
            variant="outline"
            className="bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800 capitalize"
          >
            <CheckCircle2 className="h-3 w-3 mr-1" />
            {status}
          </Badge>
        );
      case "failure":
        return (
          <Badge
            variant="outline"
            className="bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-800 capitalize"
          >
            <XCircle className="h-3 w-3 mr-1" />
            {status}
          </Badge>
        );
      case "pending":
        return (
          <Badge
            variant="outline"
            className="bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800 capitalize"
          >
            <Clock className="h-3 w-3 mr-1" />
            {status}
          </Badge>
        );
      case "partial":
        return (
          <Badge
            variant="outline"
            className="bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-800 capitalize"
          >
            <BarChart3 className="h-3 w-3 mr-1" />
            {status}
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="capitalize">
            {status}
          </Badge>
        );
    }
  };

  const handleRowClick = (id: string) => {
    navigate(`/activities/${id}`);
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Activity Feed"
          description="View all system activities and events"
        />
        <Loading />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Activity Feed"
          description="View all system activities and events"
        />
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-3 py-6">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <div>
              <p className="font-medium text-destructive">
                Error loading activities
              </p>
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
        title="Activity Feed"
        description="View all system activities and events"
      />

      <Card className="shadow-sm">
        <CardHeader className="pb-4 border-b">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2 text-lg">
                <div className="p-1.5 rounded-md bg-primary/10">
                  <List className="h-4 w-4 text-primary" />
                </div>
                Recent Activities
              </CardTitle>
              <CardDescription>
                <Badge variant="outline" className="font-normal">
                  {activities.length} activities found
                </Badge>
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0 px-0">
          {activities.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-12">
              No activities found. Activities will appear here when the system
              processes events.
            </p>
          ) : (
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
                      Action
                    </th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Tool
                    </th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Status
                    </th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Tokens
                    </th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Cost
                    </th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider"></th>
                  </tr>
                </thead>
                <tbody>
                  {activities.map((activity, index) => (
                    <tr
                      key={activity.id}
                      className={`border-b last:border-0 hover:bg-muted/60 cursor-pointer transition-colors ${
                        index % 2 === 1 ? "bg-muted/20" : ""
                      }`}
                      onClick={() => handleRowClick(activity.id)}
                    >
                      <td className="py-3 px-4 text-sm whitespace-nowrap">
                        <span className="tabular-nums text-muted-foreground">
                          {formatTimestamp(activity.timestamp)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-sm">
                        <div className="flex flex-col">
                          <span className="font-medium truncate max-w-[160px]">
                            {activity.actor.emoji && (
                              <span className="mr-1">
                                {activity.actor.emoji}
                              </span>
                            )}
                            {activity.actor.displayName || activity.actor.id}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {activity.actor.type}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-sm">
                        <Badge variant="secondary" className="font-medium">
                          {activity.actionType}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-sm text-muted-foreground">
                        {activity.toolName ? (
                          <span className="font-mono text-xs">
                            {activity.toolName}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-sm">
                        {getStatusBadge(activity.status)}
                      </td>
                      <td className="py-3 px-4 text-sm text-right tabular-nums">
                        {activity.tokens?.totalTokens?.toLocaleString() || (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-sm text-right font-medium tabular-nums">
                        {activity.cost ? (
                          formatCost(activity.cost)
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="opacity-0 group-hover:opacity-100 hover:opacity-100"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRowClick(activity.id);
                          }}
                        >
                          <ArrowRight className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
