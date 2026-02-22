import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Activity } from "@/types/activity";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  DollarSign,
  Hash,
  RefreshCw,
  Zap,
} from "lucide-react";
import { Loading } from "@/components/_shared/Loading";
import { useRef, useState, useEffect } from "react";

interface AgentActivityFeedProps {
  activities: Activity[];
  isLoading: boolean;
  error: string | null;
  isSubscribed: boolean;
  onRefresh: () => void;
  agentName?: string;
}

/**
 * Component to display activity feed for an agent
 * Shows real-time or fetched activities in a chronological list
 */
export function AgentActivityFeed({
  activities,
  isLoading,
  error,
  isSubscribed,
  onRefresh,
  agentName = "Agent",
}: AgentActivityFeedProps) {
  const feedContainerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Detect when user scrolls up (disable auto-scroll) or down (enable auto-scroll)
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const container = e.currentTarget;
    const isAtBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight < 100;
    setAutoScroll(isAtBottom);
  };

  // Auto-scroll to bottom when new activities arrive
  useEffect(() => {
    if (autoScroll && feedContainerRef.current) {
      feedContainerRef.current.scrollTo({
        top: feedContainerRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [activities]);

  const getStatusIcon = (status: Activity["status"]) => {
    switch (status) {
      case "success":
        return <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />;
      case "failure":
        return <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400" />;
      case "pending":
        return <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400 animate-spin" />;
      case "partial":
        return <AlertCircle className="h-4 w-4 text-orange-600 dark:text-orange-400" />;
      default:
        return <Hash className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusBadge = (status: Activity["status"]) => {
    switch (status) {
      case "success":
        return (
          <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800">
            Success
          </Badge>
        );
      case "failure":
        return (
          <Badge className="bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-800">
            Failed
          </Badge>
        );
      case "pending":
        return (
          <Badge className="bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800">
            Pending
          </Badge>
        );
      case "partial":
        return (
          <Badge className="bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/30 dark:text-orange-400 dark:border-orange-800">
            Partial
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getActionTypeLabel = (actionType: Activity["actionType"]) => {
    const labels: Record<Activity["actionType"], string> = {
      tool_call: "Tool Call",
      delegation: "Delegation",
      api_call: "API Call",
      decision: "Decision",
      message: "Message",
      event: "Event",
      user_request: "User Request",
      agent_spawn: "Agent Spawn",
      session_start: "Session Start",
      session_end: "Session End",
    };
    return labels[actionType] || actionType;
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;

    return date.toLocaleString();
  };

  const formatCost = (cost: number) => {
    if (cost === 0) return "$0.00";
    if (cost < 0.01) return `$${cost.toFixed(4)}`;
    return `$${cost.toFixed(2)}`;
  };

  const formatTokens = (tokens: number) => {
    if (tokens === 0) return "0";
    if (tokens < 1000) return tokens.toString();
    if (tokens < 1000000) return `${(tokens / 1000).toFixed(1)}K`;
    return `${(tokens / 1000000).toFixed(1)}M`;
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Activity Feed</CardTitle>
        </CardHeader>
        <CardContent>
          <Loading />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive">
        <CardHeader>
          <CardTitle>Activity Feed</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 text-destructive">
            <AlertCircle className="h-5 w-5 flex-shrink-0" />
            <div>
              <p className="font-medium">Error loading activities</p>
              <p className="text-sm">{error}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (activities.length === 0) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Activity Feed</CardTitle>
          <div className="flex items-center gap-2">
            {isSubscribed && (
              <Badge variant="outline" className="text-xs">
                <span className="h-2 w-2 rounded-full bg-emerald-500 mr-1.5" />
                Live
              </Badge>
            )}
            <Button variant="outline" size="sm" onClick={onRefresh}>
              <RefreshCw className="h-3 w-3" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-center text-muted-foreground py-8">
            No activities recorded for {agentName} yet
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Activity Feed ({activities.length})</CardTitle>
        <div className="flex items-center gap-2">
          {isSubscribed && (
            <Badge variant="outline" className="text-xs">
              <span className="h-2 w-2 rounded-full bg-emerald-500 mr-1.5 animate-pulse" />
              Live
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={onRefresh}>
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div
          ref={feedContainerRef}
          onScroll={handleScroll}
          className="space-y-3 max-h-[600px] overflow-y-auto pr-2"
        >
          {activities.map((activity) => (
            <div
              key={activity.id}
              className="flex gap-3 rounded-lg border p-3 hover:bg-muted/50 transition-colors"
            >
              {/* Status Icon */}
              <div className="flex items-start pt-1 flex-shrink-0">
                {getStatusIcon(activity.status)}
              </div>

              {/* Main Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <p className="font-medium text-sm">
                      {getActionTypeLabel(activity.actionType)}
                      {activity.toolName && (
                        <span className="text-muted-foreground"> · {activity.toolName}</span>
                      )}
                    </p>
                    <p className="text-sm text-muted-foreground truncate">
                      {activity.description}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {getStatusBadge(activity.status)}
                  </div>
                </div>

                {/* Details Row */}
                <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatTimestamp(activity.timestamp)}
                  </div>

                  {activity.tokens && (
                    <div className="flex items-center gap-1">
                      <Zap className="h-3 w-3" />
                      {formatTokens(activity.tokens.totalTokens)} tokens
                    </div>
                  )}

                  {activity.cost && (
                    <div className="flex items-center gap-1">
                      <DollarSign className="h-3 w-3" />
                      {formatCost(activity.cost.usd)}
                    </div>
                  )}

                  {activity.durationMs && (
                    <div className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {(activity.durationMs / 1000).toFixed(2)}s
                    </div>
                  )}
                </div>

                {/* Error Message */}
                {activity.status === "failure" && activity.result?.error && (
                  <div className="mt-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 p-2 rounded border border-red-200 dark:border-red-800">
                    {activity.result.error}
                  </div>
                )}

                {/* Tags */}
                {activity.tags && activity.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {activity.tags.map((tag) => (
                      <Badge
                        key={tag}
                        variant="secondary"
                        className="text-xs"
                      >
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
