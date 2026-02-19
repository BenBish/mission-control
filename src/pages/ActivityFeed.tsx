import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/_shared/PageHeader";
import { Loading } from "@/components/_shared/Loading";
import type { Activity } from "@/types/activity";
import { List, ArrowRight, AlertCircle } from "lucide-react";

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

  useEffect(() => {
    const fetchActivities = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch("http://localhost:3001/api/activities?limit=100");
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
  }, []);

  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleString();
  };

  const formatCost = (cost?: { usd: number }) => {
    if (!cost) return "$0.0000";
    return `$${cost.usd.toFixed(4)}`;
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
              <p className="font-medium text-destructive">Error loading activities</p>
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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <List className="h-5 w-5" />
            Recent Activities
          </CardTitle>
          <CardDescription>
            {activities.length} activities found
          </CardDescription>
        </CardHeader>
        <CardContent>
          {activities.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-8">
              No activities found. Activities will appear here when the system processes events.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-2 text-sm font-medium text-muted-foreground">Time</th>
                    <th className="text-left py-3 px-2 text-sm font-medium text-muted-foreground">Actor</th>
                    <th className="text-left py-3 px-2 text-sm font-medium text-muted-foreground">Action</th>
                    <th className="text-left py-3 px-2 text-sm font-medium text-muted-foreground">Tool</th>
                    <th className="text-left py-3 px-2 text-sm font-medium text-muted-foreground">Status</th>
                    <th className="text-right py-3 px-2 text-sm font-medium text-muted-foreground">Tokens</th>
                    <th className="text-right py-3 px-2 text-sm font-medium text-muted-foreground">Cost</th>
                    <th className="text-right py-3 px-2 text-sm font-medium text-muted-foreground"></th>
                  </tr>
                </thead>
                <tbody>
                  {activities.map((activity) => (
                    <tr
                      key={activity.id}
                      className="border-b last:border-0 hover:bg-muted/50 cursor-pointer transition-colors"
                      onClick={() => handleRowClick(activity.id)}
                    >
                      <td className="py-3 px-2 text-sm whitespace-nowrap">
                        {formatTimestamp(activity.timestamp)}
                      </td>
                      <td className="py-3 px-2 text-sm">
                        <span className="inline-flex items-center gap-1">
                          <span className="text-xs text-muted-foreground">{activity.actor.type}:</span>
                          <span className="font-medium truncate max-w-[120px]">{activity.actor.id}</span>
                        </span>
                      </td>
                      <td className="py-3 px-2 text-sm">
                        <span className="inline-flex items-center rounded-md bg-secondary px-2 py-0.5 text-xs font-medium">
                          {activity.actionType}
                        </span>
                      </td>
                      <td className="py-3 px-2 text-sm text-muted-foreground">
                        {activity.toolName || "—"}
                      </td>
                      <td className="py-3 px-2 text-sm">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${getStatusColor(
                            activity.status
                          )}`}
                        >
                          {activity.status}
                        </span>
                      </td>
                      <td className="py-3 px-2 text-sm text-right">
                        {activity.tokens?.totalTokens?.toLocaleString() || "—"}
                      </td>
                      <td className="py-3 px-2 text-sm text-right font-medium">
                        {formatCost(activity.cost)}
                      </td>
                      <td className="py-3 px-2 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
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
