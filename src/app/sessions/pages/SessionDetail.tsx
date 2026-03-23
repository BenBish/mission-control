import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useSession } from "../hooks/useSessions";
import { PageHeader } from "@/components/_shared/PageHeader";
import { Loading } from "@/components/_shared/Loading";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Copy,
  DollarSign,
  Hash,
  XCircle,
  Zap,
} from "lucide-react";
import { useProfile } from "@/app/profile-context";
import { apiFetch } from "@/lib/api-client";
import type { Activity } from "@/types/activity";
import { SessionTimeline } from "../components/SessionTimeline";

function formatDuration(startTime: string, endTime?: string): string {
  if (!endTime) return "Ongoing";
  const ms = new Date(endTime).getTime() - new Date(startTime).getTime();
  if (ms < 0) return "0s";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

function formatCost(cost: number): string {
  if (cost === 0) return "$0.00";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

function formatTokens(tokens: number): string {
  if (tokens === 0) return "0";
  if (tokens < 1000) return tokens.toString();
  if (tokens < 1000000) return `${(tokens / 1000).toFixed(1)}K`;
  return `${(tokens / 1000000).toFixed(1)}M`;
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return date.toLocaleString();
}

export default function SessionDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { profileId, isSwitching } = useProfile();
  const { session, isLoading, error } = useSession(id || "", profileId);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [activitiesLoading, setActivitiesLoading] = useState(true);
  const [activitiesError, setActivitiesError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchActivities = useCallback(async () => {
    if (!id) return;
    setActivitiesLoading(true);
    setActivitiesError(null);
    try {
      const params = profileId
        ? `?profile=${encodeURIComponent(profileId)}`
        : "";
      const response = await apiFetch(
        `/api/sessions/${id}/activities${params}`,
      );
      if (!response.ok) {
        throw new Error(`Failed to fetch activities: ${response.statusText}`);
      }
      const data = await response.json();
      if (data.success) {
        setActivities(data.activities);
      }
    } catch (err) {
      setActivitiesError(
        err instanceof Error ? err.message : "Unknown error occurred",
      );
    } finally {
      setActivitiesLoading(false);
    }
  }, [id, profileId]);

  useEffect(() => {
    fetchActivities();
  }, [fetchActivities]);

  const handleCopyId = () => {
    if (id) {
      navigator.clipboard.writeText(id);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (!id) {
    return (
      <div className="space-y-6">
        <PageHeader title="Session" description="Session details" />
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-3 py-6">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <p className="font-medium text-destructive">Invalid session ID</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading || isSwitching) {
    return (
      <div className="space-y-6">
        <PageHeader title="Session" description="Loading session details..." />
        <Loading />
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="space-y-6">
        <PageHeader title="Session" description="Session details" />
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-3 py-6">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <div>
              <p className="font-medium text-destructive">
                Error loading session
              </p>
              <p className="text-sm text-muted-foreground">
                {error || "Session not found"}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

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
      default:
        return (
          <Badge variant="outline" className="capitalize">
            {status}
          </Badge>
        );
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          className="gap-2"
          onClick={() => navigate("/sessions")}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Sessions
        </Button>
      </div>

      {/* Session Header */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-2xl flex items-center gap-2">
                Session
                <Badge
                  className={
                    session.endTime
                      ? "bg-muted text-muted-foreground"
                      : "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800"
                  }
                >
                  {session.endTime ? "Completed" : "Active"}
                </Badge>
              </CardTitle>
              <div className="mt-2 flex items-center gap-2">
                <code className="text-xs text-muted-foreground font-mono bg-muted px-2 py-1 rounded">
                  {id.length > 20 ? `${id.slice(0, 20)}...` : id}
                </code>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={handleCopyId}
                >
                  <Copy className="h-3 w-3" />
                </Button>
                {copied && (
                  <span className="text-xs text-muted-foreground">Copied!</span>
                )}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div className="space-y-1">
              <p className="flex items-center gap-1 text-sm text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                Start Time
              </p>
              <p className="text-sm font-medium">
                {new Date(session.startTime).toLocaleString()}
              </p>
            </div>
            <div className="space-y-1">
              <p className="flex items-center gap-1 text-sm text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                End Time
              </p>
              <p className="text-sm font-medium">
                {session.endTime
                  ? new Date(session.endTime).toLocaleString()
                  : "—"}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Duration</p>
              <p className="text-sm font-medium">
                {formatDuration(session.startTime, session.endTime)}
              </p>
            </div>
            <div className="space-y-1">
              <p className="flex items-center gap-1 text-sm text-muted-foreground">
                <Hash className="h-3.5 w-3.5" />
                Total Actions
              </p>
              <p className="text-sm font-medium">
                {session.stats.totalActions}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="activity">Activity Feed</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4">
          {/* Stat Cards */}
          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <Hash className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">
                      Total Actions
                    </p>
                    <p className="text-2xl font-bold">
                      {session.stats.totalActions}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10">
                    <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">
                      Success Rate
                    </p>
                    <p className="text-2xl font-bold">
                      {session.stats.successRate.toFixed(0)}%
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10">
                    <DollarSign className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Total Cost</p>
                    <p className="text-2xl font-bold">
                      {formatCost(session.stats.totalCost)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
                    <Zap className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">
                      Total Tokens
                    </p>
                    <p className="text-2xl font-bold">
                      {formatTokens(session.stats.totalTokens)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Top Tools */}
          {session.topTools.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Top Tools</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 px-0">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left py-2 px-4 text-xs font-semibold text-muted-foreground uppercase">
                        Tool
                      </th>
                      <th className="text-right py-2 px-4 text-xs font-semibold text-muted-foreground uppercase">
                        Calls
                      </th>
                      <th className="text-right py-2 px-4 text-xs font-semibold text-muted-foreground uppercase">
                        Cost
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {session.topTools.map((tool) => (
                      <tr key={tool.name} className="border-b last:border-0">
                        <td className="py-2 px-4 text-sm font-mono">
                          {tool.name}
                        </td>
                        <td className="py-2 px-4 text-sm text-right tabular-nums">
                          {tool.count}
                        </td>
                        <td className="py-2 px-4 text-sm text-right tabular-nums">
                          {formatCost(tool.cost)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          {/* Actor Breakdown */}
          {Object.keys(session.actors).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Actor Breakdown</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 px-0">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left py-2 px-4 text-xs font-semibold text-muted-foreground uppercase">
                        Actor
                      </th>
                      <th className="text-right py-2 px-4 text-xs font-semibold text-muted-foreground uppercase">
                        Actions
                      </th>
                      <th className="text-right py-2 px-4 text-xs font-semibold text-muted-foreground uppercase">
                        Cost
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(session.actors).map(([actorId, actor]) => (
                      <tr key={actorId} className="border-b last:border-0">
                        <td className="py-2 px-4 text-sm font-medium">
                          {actor.name}
                        </td>
                        <td className="py-2 px-4 text-sm text-right tabular-nums">
                          {actor.actionsCount}
                        </td>
                        <td className="py-2 px-4 text-sm text-right tabular-nums">
                          {formatCost(actor.costUsd)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Activity Feed Tab */}
        <TabsContent value="activity">
          <Card>
            <CardHeader>
              <CardTitle>Activity Feed ({activities.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {activitiesLoading ? (
                <Loading />
              ) : activitiesError ? (
                <div className="flex items-center gap-3 text-destructive">
                  <AlertCircle className="h-5 w-5 flex-shrink-0" />
                  <p className="text-sm">{activitiesError}</p>
                </div>
              ) : activities.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">
                  No activities recorded for this session yet
                </p>
              ) : (
                <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2">
                  {activities.map((activity) => (
                    <div
                      key={activity.id}
                      className="flex gap-3 rounded-lg border p-3 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-start pt-1 flex-shrink-0">
                        {activity.status === "success" ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                        ) : activity.status === "failure" ? (
                          <XCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
                        ) : (
                          <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1">
                            <p className="font-medium text-sm">
                              {activity.actionType}
                              {activity.toolName && (
                                <span className="text-muted-foreground">
                                  {" "}
                                  · {activity.toolName}
                                </span>
                              )}
                            </p>
                            <p className="text-sm text-muted-foreground truncate">
                              {activity.description}
                            </p>
                          </div>
                          {getStatusBadge(activity.status)}
                        </div>
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
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Timeline Tab */}
        <TabsContent value="timeline">
          {activitiesLoading ? (
            <Loading />
          ) : activitiesError ? (
            <Card>
              <CardContent className="flex items-center gap-3 py-6 text-destructive">
                <AlertCircle className="h-5 w-5 flex-shrink-0" />
                <p className="text-sm">{activitiesError}</p>
              </CardContent>
            </Card>
          ) : (
            <SessionTimeline activities={activities} session={session} />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
