import { useCallback, useMemo, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/_shared/PageHeader";
import { Loading } from "@/components/_shared/Loading";
import type { Activity, ActionType, ActivityStatus } from "@/types/activity";
import { actorIcon } from "@/lib/actor-display";
import { useSourceFilter } from "@/app/source-context";
import { useActivityList } from "@/lib/queries";
import { useSSE } from "@/hooks/useSSE";
import {
  List,
  ArrowRight,
  CheckCircle2,
  XCircle,
  Clock,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  X,
} from "lucide-react";

interface Filters {
  status: string;
  actionType: string;
  actorId: string;
  toolName: string;
  startTime: string;
  endTime: string;
}

const EMPTY_FILTERS: Filters = {
  status: "",
  actionType: "",
  actorId: "",
  toolName: "",
  startTime: "",
  endTime: "",
};

const PAGE_SIZE = 50;

const STATUS_OPTIONS = ["success", "failure", "pending", "partial"];
const ACTION_TYPE_OPTIONS = [
  "tool_call",
  "delegation",
  "api_call",
  "decision",
  "message",
  "event",
  "user_request",
  "agent_spawn",
  "session_start",
  "session_end",
];

export default function ActivityFeed() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { selectedSourceId } = useSourceFilter();
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [hasNewActivity, setHasNewActivity] = useState(false);

  const hasActiveFilters = useMemo(
    () => Object.values(filters).some((v) => v !== ""),
    [filters],
  );

  const updateFilter = useCallback((key: keyof Filters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  }, []);

  const clearFilters = useCallback(() => {
    setFilters(EMPTY_FILTERS);
    setPage(1);
  }, []);

  const queryFilter = useMemo(
    () => ({
      sourceId: selectedSourceId,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
      status: (filters.status || undefined) as ActivityStatus | undefined,
      actionType: (filters.actionType || undefined) as ActionType | undefined,
      actorId: filters.actorId || undefined,
      toolName: filters.toolName || undefined,
      startTime: filters.startTime
        ? new Date(filters.startTime).toISOString()
        : undefined,
      endTime: filters.endTime
        ? new Date(filters.endTime).toISOString()
        : undefined,
    }),
    [selectedSourceId, page, filters],
  );

  const { data: activities, isLoading, error } = useActivityList(queryFilter);

  useSSE({
    onActivity: () => {
      if (hasActiveFilters || page > 1) {
        setHasNewActivity(true);
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["activities"] });
    },
  });

  const handleRefreshBanner = () => {
    setHasNewActivity(false);
    queryClient.invalidateQueries({ queryKey: ["activities"] });
  };

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

  const handleRowClick = (id: string) => navigate(`/activities/${id}`);

  const count = activities?.length ?? 0;
  const offset = (page - 1) * PAGE_SIZE;
  const showingFrom = count > 0 ? offset + 1 : 0;
  const showingTo = offset + count;

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Activity Feed"
          description="View all system activities and events"
        />
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-3 py-6">
            <X className="h-5 w-5 text-destructive" />
            <div>
              <p className="font-medium text-destructive">
                Error loading activities
              </p>
              <p className="text-sm text-muted-foreground">
                {error instanceof Error ? error.message : "Unknown error"}
              </p>
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

      {/* Filter bar */}
      <Card className="shadow-sm">
        <CardContent className="py-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Status
              </label>
              <Select
                value={filters.status || "all"}
                onValueChange={(v) =>
                  updateFilter("status", v === "all" ? "" : v)
                }
              >
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s} className="capitalize">
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Action Type
              </label>
              <Select
                value={filters.actionType || "all"}
                onValueChange={(v) =>
                  updateFilter("actionType", v === "all" ? "" : v)
                }
              >
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {ACTION_TYPE_OPTIONS.map((a) => (
                    <SelectItem key={a} value={a}>
                      {a}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Actor
              </label>
              <Input
                placeholder="Filter by actor..."
                value={filters.actorId}
                onChange={(e) => updateFilter("actorId", e.target.value)}
                className="w-[160px]"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Tool
              </label>
              <Input
                placeholder="Filter by tool..."
                value={filters.toolName}
                onChange={(e) => updateFilter("toolName", e.target.value)}
                className="w-[160px]"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                From
              </label>
              <Input
                type="date"
                value={filters.startTime}
                onChange={(e) => updateFilter("startTime", e.target.value)}
                className="w-[150px]"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                To
              </label>
              <Input
                type="date"
                value={filters.endTime}
                onChange={(e) => updateFilter("endTime", e.target.value)}
                className="w-[150px]"
              />
            </div>

            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <X className="h-4 w-4 mr-1" />
                Clear Filters
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {hasNewActivity && (
        <div
          className="flex items-center justify-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-700 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-400 cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-950/50 transition-colors"
          onClick={handleRefreshBanner}
        >
          <RefreshCw className="h-4 w-4" />
          New activity — click to refresh
        </div>
      )}

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
                  {count} activities
                </Badge>
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0 px-0">
          {isLoading ? (
            <div className="py-12">
              <Loading />
            </div>
          ) : count === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-12">
              No activities found. Activities will appear here when the
              collectors ingest events.
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
                      Session
                    </th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Status
                    </th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Tokens
                    </th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider"></th>
                  </tr>
                </thead>
                <tbody>
                  {(activities as Activity[]).map((activity, index) => {
                    const Icon = actorIcon(activity.actor.type);
                    return (
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
                            <span className="font-medium truncate max-w-[160px] flex items-center gap-1.5">
                              <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                              {activity.actor.id}
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
                          {activity.sessionId ? (
                            <Link
                              to={`/sessions/${activity.sessionId}`}
                              className="font-mono text-xs text-primary hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {activity.sessionId.slice(0, 8)}...
                            </Link>
                          ) : (
                            <span className="text-muted-foreground/50">—</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-sm">
                          {getStatusBadge(activity.status)}
                        </td>
                        <td className="py-3 px-4 text-sm text-right tabular-nums">
                          {activity.totalTokens?.toLocaleString() ?? (
                            <span className="text-muted-foreground/50">—</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right">
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
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!isLoading && count > 0 && (
            <div className="flex items-center justify-between border-t px-4 py-3">
              <span className="text-sm text-muted-foreground">
                Showing {showingFrom}–{showingTo}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={count < PAGE_SIZE}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
