import { useMemo, useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, DollarSign, ListOrdered } from "lucide-react";
import type { Activity, ActivityStatus } from "@/types/activity";
import type { SessionSummary } from "@/types/activity";

interface SessionTimelineProps {
  activities: Activity[];
  session: SessionSummary;
}

const STATUS_COLORS: Record<
  ActivityStatus,
  { bg: string; border: string; text: string }
> = {
  success: {
    bg: "bg-emerald-500",
    border: "border-emerald-600",
    text: "text-emerald-700 dark:text-emerald-400",
  },
  failure: {
    bg: "bg-red-500",
    border: "border-red-600",
    text: "text-red-700 dark:text-red-400",
  },
  pending: {
    bg: "bg-amber-500",
    border: "border-amber-600",
    text: "text-amber-700 dark:text-amber-400",
  },
  partial: {
    bg: "bg-blue-500",
    border: "border-blue-600",
    text: "text-blue-700 dark:text-blue-400",
  },
};

const ACTOR_COLORS = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-purple-500",
  "bg-rose-500",
  "bg-cyan-500",
  "bg-orange-500",
  "bg-indigo-500",
];

const LANE_HEIGHT = 48;
const LABEL_WIDTH = 140;
const TIMELINE_PADDING = 16;
const MIN_PILL_WIDTH = 6;

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rs = Math.floor(s % 60);
  return `${m}m ${rs}s`;
}

function formatCost(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

interface TooltipState {
  activity: Activity;
  x: number;
  y: number;
  containerWidth: number;
}

export function SessionTimeline({ activities, session }: SessionTimelineProps) {
  const navigate = useNavigate();
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const sortedActivities = useMemo(
    () =>
      [...activities].sort(
        (a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      ),
    [activities],
  );

  const hasTimelineData = useMemo(() => {
    if (activities.length <= 1) return false;
    return activities.some((a) => a.durationMs != null);
  }, [activities]);

  // Compute timeline bounds and actor lanes.
  // For active sessions without endTime, use the latest activity timestamp as the end bound.
  const { actorLanes, timeStart, totalDurationMs } = useMemo(() => {
    const start = new Date(session.startTime).getTime();
    let end: number;
    if (session.endTime) {
      end = new Date(session.endTime).getTime();
    } else {
      // Use latest activity completedAt or timestamp as end bound
      let latest = start;
      for (const a of sortedActivities) {
        const t = a.completedAt
          ? new Date(a.completedAt).getTime()
          : new Date(a.timestamp).getTime() + (a.durationMs || 0);
        if (t > latest) latest = t;
      }
      end = latest > start ? latest : start + 60000; // fallback 1 min
    }
    const total = end - start;

    const actorMap = new Map<string, { id: string; name: string }>();
    for (const activity of sortedActivities) {
      if (!actorMap.has(activity.actor.id)) {
        actorMap.set(activity.actor.id, {
          id: activity.actor.id,
          name: activity.actor.displayName || activity.actor.id,
        });
      }
    }

    return {
      actorLanes: Array.from(actorMap.values()),
      timeStart: start,
      totalDurationMs: total,
    };
  }, [session, sortedActivities]);

  const { activeTimeMs, idleTimeMs } = useMemo(() => {
    let active = 0;
    for (const a of sortedActivities) {
      if (a.durationMs) active += a.durationMs;
    }
    return {
      activeTimeMs: active,
      idleTimeMs: Math.max(0, totalDurationMs - active),
    };
  }, [sortedActivities, totalDurationMs]);

  const actorCosts = useMemo(() => {
    const costs = new Map<string, { name: string; cost: number }>();
    let totalCost = 0;
    for (const a of sortedActivities) {
      const cost = a.cost?.usd || 0;
      totalCost += cost;
      const existing = costs.get(a.actor.id);
      if (existing) {
        existing.cost += cost;
      } else {
        costs.set(a.actor.id, {
          name: a.actor.displayName || a.actor.id,
          cost,
        });
      }
    }
    return { byActor: Array.from(costs.entries()), totalCost };
  }, [sortedActivities]);

  const timeLabels = useMemo(() => {
    const labels: { label: string }[] = [];
    const count = Math.min(6, Math.max(2, Math.floor(totalDurationMs / 60000)));
    for (let i = 0; i <= count; i++) {
      const ms = totalDurationMs * (i / count);
      labels.push({ label: formatMs(ms) });
    }
    return labels;
  }, [totalDurationMs]);

  const handlePillHover = useCallback(
    (activity: Activity, e: React.MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setTooltip({
        activity,
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        containerWidth: rect.width,
      });
    },
    [],
  );

  const handlePillLeave = useCallback(() => {
    setTooltip(null);
  }, []);

  const handlePillClick = useCallback(
    (activityId: string) => {
      navigate(`/activities/${activityId}`);
    },
    [navigate],
  );

  // Simple ordered list fallback
  if (!hasTimelineData) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ListOrdered className="h-4 w-4" />
            Activity Timeline
          </CardTitle>
        </CardHeader>
        <CardContent>
          {activities.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              No activities recorded for this session
            </p>
          ) : (
            <div className="space-y-2">
              {sortedActivities.map((activity, index) => {
                const colors = STATUS_COLORS[activity.status];
                return (
                  <button
                    key={activity.id}
                    onClick={() => handlePillClick(activity.id)}
                    className="flex items-center gap-3 w-full rounded-lg border p-3 hover:bg-muted/50 transition-colors text-left"
                  >
                    <span className="text-xs text-muted-foreground tabular-nums w-6">
                      {index + 1}
                    </span>
                    <span
                      className={`h-2 w-2 rounded-full flex-shrink-0 ${colors.bg}`}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {activity.description}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {activity.actor.displayName || activity.actor.id}
                        {activity.toolName && ` · ${activity.toolName}`}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={`text-xs ${colors.text}`}
                    >
                      {activity.status}
                    </Badge>
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary Bar */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-6">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Total Duration</p>
                <p className="text-sm font-medium">
                  {formatDuration(totalDurationMs)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-emerald-500" />
              <div>
                <p className="text-xs text-muted-foreground">Active Time</p>
                <p className="text-sm font-medium">
                  {formatDuration(activeTimeMs)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground/50" />
              <div>
                <p className="text-xs text-muted-foreground">Idle Time</p>
                <p className="text-sm font-medium">
                  {formatDuration(idleTimeMs)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-amber-500" />
              <div>
                <p className="text-xs text-muted-foreground">Total Cost</p>
                <p className="text-sm font-medium">
                  {formatCost(actorCosts.totalCost)}
                </p>
              </div>
            </div>
          </div>

          {/* Cost distribution bar */}
          {actorCosts.totalCost > 0 && (
            <div className="mt-4">
              <p className="text-xs text-muted-foreground mb-1">
                Cost by Actor
              </p>
              <div
                className="flex h-3 rounded-full overflow-hidden"
                data-testid="cost-distribution-bar"
              >
                {actorCosts.byActor.map(([actorId, { cost }], index) => {
                  const pct = (cost / actorCosts.totalCost) * 100;
                  if (pct < 0.5) return null;
                  return (
                    <div
                      key={actorId}
                      className={`${ACTOR_COLORS[index % ACTOR_COLORS.length]} transition-all`}
                      style={{ width: `${pct}%` }}
                      title={`${actorCosts.byActor[index][1].name}: ${formatCost(cost)}`}
                    />
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-3 mt-2">
                {actorCosts.byActor.map(([actorId, { name, cost }], index) => (
                  <div key={actorId} className="flex items-center gap-1.5">
                    <span
                      className={`h-2 w-2 rounded-full ${ACTOR_COLORS[index % ACTOR_COLORS.length]}`}
                    />
                    <span className="text-xs text-muted-foreground">
                      {name}: {formatCost(cost)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Swimlane Timeline */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Activity Swimlanes</CardTitle>
        </CardHeader>
        <CardContent>
          <div
            ref={containerRef}
            className="relative overflow-x-auto"
            data-testid="timeline-swimlanes"
          >
            {/* Time axis */}
            <div
              className="flex items-end border-b border-border/50 pb-1 mb-1"
              style={{ paddingLeft: LABEL_WIDTH + TIMELINE_PADDING }}
            >
              <div className="w-full flex justify-between">
                {timeLabels.map(({ label }, i) => (
                  <span key={i} className="text-[10px] text-muted-foreground">
                    {label}
                  </span>
                ))}
              </div>
            </div>

            {/* Lanes */}
            {actorLanes.map((actor) => {
              const laneActivities = sortedActivities.filter(
                (a) => a.actor.id === actor.id,
              );

              return (
                <div
                  key={actor.id}
                  className="flex items-center border-b border-border/30 last:border-0"
                  style={{ height: LANE_HEIGHT }}
                  data-testid={`timeline-lane-${actor.id}`}
                >
                  {/* Actor label */}
                  <div
                    className="flex-shrink-0 px-2 text-xs font-medium truncate text-muted-foreground"
                    style={{ width: LABEL_WIDTH }}
                    title={actor.name}
                  >
                    {actor.name}
                  </div>

                  {/* Timeline track */}
                  <div
                    className="flex-1 relative h-full"
                    style={{ padding: `0 ${TIMELINE_PADDING}px` }}
                  >
                    {laneActivities.map((activity) => {
                      const actStart =
                        new Date(activity.timestamp).getTime() - timeStart;
                      const leftPct =
                        totalDurationMs > 0
                          ? (actStart / totalDurationMs) * 100
                          : 0;
                      const hasDuration =
                        activity.durationMs != null && activity.durationMs > 0;
                      const widthPct = hasDuration
                        ? ((activity.durationMs ?? 0) / totalDurationMs) * 100
                        : 0;
                      const colors = STATUS_COLORS[activity.status];

                      if (!hasDuration) {
                        return (
                          <button
                            key={activity.id}
                            className={`absolute top-1/2 -translate-y-1/2 h-3 w-3 rounded-full ${colors.bg} hover:ring-2 hover:ring-offset-1 hover:ring-current cursor-pointer transition-shadow z-10`}
                            style={{ left: `${leftPct}%` }}
                            onClick={() => handlePillClick(activity.id)}
                            onMouseEnter={(e) => handlePillHover(activity, e)}
                            onMouseLeave={handlePillLeave}
                            data-testid={`timeline-dot-${activity.id}`}
                            aria-label={`${activity.description} - ${activity.status}`}
                          />
                        );
                      }

                      return (
                        <button
                          key={activity.id}
                          className={`absolute top-1/2 -translate-y-1/2 h-5 rounded-full ${colors.bg} opacity-80 hover:opacity-100 hover:ring-2 hover:ring-offset-1 hover:ring-current cursor-pointer transition-all z-10`}
                          style={{
                            left: `${leftPct}%`,
                            width: `max(${MIN_PILL_WIDTH}px, ${widthPct}%)`,
                          }}
                          onClick={() => handlePillClick(activity.id)}
                          onMouseEnter={(e) => handlePillHover(activity, e)}
                          onMouseLeave={handlePillLeave}
                          data-testid={`timeline-pill-${activity.id}`}
                          aria-label={`${activity.description} - ${activity.status} - ${formatMs(activity.durationMs ?? 0)}`}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {/* Tooltip */}
            {tooltip && (
              <div
                className="absolute z-50 bg-popover text-popover-foreground border rounded-lg shadow-lg p-3 text-xs pointer-events-none"
                style={{
                  left: Math.min(tooltip.x, tooltip.containerWidth - 220),
                  top: tooltip.y - 80,
                  minWidth: 200,
                }}
                data-testid="timeline-tooltip"
              >
                <p className="font-medium text-sm mb-1 truncate">
                  {tooltip.activity.description}
                </p>
                {tooltip.activity.toolName && (
                  <p className="text-muted-foreground">
                    Tool: {tooltip.activity.toolName}
                  </p>
                )}
                <p className="text-muted-foreground">
                  Status:{" "}
                  <span className={STATUS_COLORS[tooltip.activity.status].text}>
                    {tooltip.activity.status}
                  </span>
                </p>
                {tooltip.activity.durationMs != null && (
                  <p className="text-muted-foreground">
                    Duration: {formatMs(tooltip.activity.durationMs)}
                  </p>
                )}
                {tooltip.activity.cost && (
                  <p className="text-muted-foreground">
                    Cost: {formatCost(tooltip.activity.cost.usd)}
                  </p>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
