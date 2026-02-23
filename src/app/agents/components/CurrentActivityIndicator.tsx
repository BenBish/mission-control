import { useState, useEffect, useCallback, useRef } from "react";
import type { Activity } from "@/types/activity";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toActorId } from "@/lib/agent-utils";
import { useActivityStream } from "@/app/agents/context/ActivityStreamContext";

interface CurrentActivityIndicatorProps {
  agentId: string;
  agentName?: string;
  compact?: boolean;
  mode?: "compact" | "full";
}

/**
 * Real-time indicator showing the current activity status of an agent.
 *
 * Uses the shared ActivityStreamContext rather than opening its own EventSource,
 * preventing N+1 SSE connections when many AgentCards are on screen.
 */
export function CurrentActivityIndicator({
  agentId,
  agentName = "Agent",
  compact = false,
  mode,
}: CurrentActivityIndicatorProps) {
  const isCompactMode = mode === "compact" || compact;
  const [currentActivity, setCurrentActivity] = useState<Activity | null>(null);
  const [status, setStatus] = useState<"idle" | "busy" | "offline">("offline");
  const statusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivityTimeRef = useRef<number>(0);

  const actorId = toActorId(agentId);

  // Derive status from an activity — defined with useCallback to keep the
  // reference stable and avoid stale-closure issues.
  const applyActivity = useCallback((activity: Activity) => {
    const activityTime = new Date(activity.timestamp).getTime();
    if (activityTime < lastActivityTimeRef.current) return; // older than current
    lastActivityTimeRef.current = activityTime;

    setCurrentActivity(activity);

    if (activity.status === "pending") {
      setStatus("busy");
      // Cancel any pending idle → offline transition
      if (statusTimeoutRef.current) {
        clearTimeout(statusTimeoutRef.current);
        statusTimeoutRef.current = null;
      }
    } else {
      setStatus("idle");
      // Auto-transition to offline after 5 minutes of inactivity
      if (statusTimeoutRef.current) {
        clearTimeout(statusTimeoutRef.current);
      }
      statusTimeoutRef.current = setTimeout(() => {
        setStatus("offline");
      }, 5 * 60 * 1000);
    }
  }, []); // no external deps — uses only refs and stable setters

  // Subscribe to the shared SSE stream
  useActivityStream(actorId, applyActivity);

  // Fetch the most recent activity on mount for initial state
  useEffect(() => {
    let cancelled = false;

    const fetchLatestActivity = async () => {
      try {
        const response = await fetch(
          `/api/activities?actorId=${encodeURIComponent(actorId)}&limit=1`
        );
        if (!response.ok || cancelled) return;
        const data = await response.json();
        if (data.success && data.activities?.length > 0 && !cancelled) {
          applyActivity(data.activities[0]);
        }
      } catch (err) {
        console.error("[CurrentActivityIndicator] Failed to fetch latest activity:", err);
      }
    };

    fetchLatestActivity();

    return () => {
      cancelled = true;
      if (statusTimeoutRef.current) {
        clearTimeout(statusTimeoutRef.current);
        statusTimeoutRef.current = null;
      }
    };
  }, [actorId, applyActivity]);

  if (isCompactMode) {
    return (
      <div
        className={cn(
          "h-2 w-2 rounded-full transition-colors duration-200",
          status === "idle"
            ? "bg-blue-500"
            : status === "busy"
              ? "bg-amber-500 animate-pulse"
              : "bg-gray-400"
        )}
        title={`${agentName} is ${status}`}
      />
    );
  }

  const getStatusColor = () => {
    switch (status) {
      case "idle":
        return "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-800";
      case "busy":
        return "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800";
      case "offline":
        return "bg-gray-50 text-gray-700 border-gray-200 dark:bg-gray-950/30 dark:text-gray-400 dark:border-gray-800";
    }
  };

  const getStatusLabel = () => {
    if (status === "busy" && currentActivity) {
      return `Busy: ${currentActivity.actionType}`;
    }
    return status.charAt(0).toUpperCase() + status.slice(1);
  };

  return (
    <Badge
      variant="outline"
      className={cn("text-xs", getStatusColor())}
      title={currentActivity?.description}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full mr-1.5",
          status === "idle"
            ? "bg-blue-500"
            : status === "busy"
              ? "bg-amber-500 animate-pulse"
              : "bg-gray-500"
        )}
      />
      {getStatusLabel()}
    </Badge>
  );
}

export type { CurrentActivityIndicatorProps };
