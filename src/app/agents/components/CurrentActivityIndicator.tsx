import { useState, useEffect, useRef } from "react";
import type { Activity } from "@/types/activity";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface CurrentActivityIndicatorProps {
  agentId: string;
  agentName?: string;
  compact?: boolean;
  mode?: 'compact' | 'full';
}

/**
 * Real-time indicator showing the current activity status of an agent
 * Derives status from the most recent activity and agent state
 */
export function CurrentActivityIndicator({
  agentId,
  agentName = 'Agent',
  compact = false,
  mode,
}: CurrentActivityIndicatorProps) {
  // Support both 'compact' prop and 'mode' prop for flexibility
  const isCompactMode = mode === 'compact' || compact;
  const [currentActivity, setCurrentActivity] = useState<Activity | null>(null);
  const [status, setStatus] = useState<"idle" | "busy" | "offline">("offline");
  const eventSourceRef = useRef<EventSource | null>(null);
  const lastActivityTimeRef = useRef<number>(0);
  const statusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Fetch the most recent activity for this agent
    const fetchLatestActivity = async () => {
      try {
        const response = await fetch(
          `/api/activities?actorId=${encodeURIComponent(agentId)}&limit=1`
        );
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.activities && data.activities.length > 0) {
            const activity = data.activities[0];
            setCurrentActivity(activity);
            lastActivityTimeRef.current = new Date(activity.timestamp).getTime();
            updateStatus(activity);
          }
        }
      } catch (err) {
        console.error("Failed to fetch latest activity:", err);
      }
    };

    fetchLatestActivity();

    // Subscribe to SSE for real-time updates
    try {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      const eventSource = new EventSource("/api/stream");
      eventSourceRef.current = eventSource;

      eventSource.addEventListener("activity", (event) => {
        try {
          const activity: Activity = JSON.parse(event.data);

          // Only process activities from this agent
          if (activity.actor.id !== agentId) {
            return;
          }

          // Update if this is more recent
          const activityTime = new Date(activity.timestamp).getTime();
          if (activityTime >= lastActivityTimeRef.current) {
            setCurrentActivity(activity);
            lastActivityTimeRef.current = activityTime;
            updateStatus(activity);
          }
        } catch (err) {
          console.error("Error parsing SSE activity:", err);
        }
      });

      eventSource.addEventListener("error", () => {
        setStatus("offline");
      });
    } catch (err) {
      console.error("Failed to subscribe to SSE:", err);
      setStatus("offline");
    }

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (statusTimeoutRef.current) {
        clearTimeout(statusTimeoutRef.current);
      }
    };
  }, [agentId]);

  /**
   * Update status based on activity
   */
  const updateStatus = (activity: Activity) => {
    // If activity is pending or just completed, agent is busy
    if (activity.status === "pending") {
      setStatus("busy");
    } else {
      // Activity completed; agent is idle
      setStatus("idle");

      // Auto-transition to offline after 5 minutes of inactivity
      if (statusTimeoutRef.current) {
        clearTimeout(statusTimeoutRef.current);
      }

      statusTimeoutRef.current = setTimeout(() => {
        setStatus("offline");
      }, 5 * 60 * 1000);
    }
  };

  if (isCompactMode) {
    // Compact version: just a small status indicator dot
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

  // Full version: badge with status and optional activity description
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
