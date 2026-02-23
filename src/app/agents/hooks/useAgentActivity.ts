import { useState, useEffect, useCallback, useRef } from "react";
import type { Activity } from "@/types/activity";
import { toActorId } from "@/lib/agent-utils";
import { useActivityStream } from "@/app/agents/context/ActivityStreamContext";

/** Maximum number of activities kept in memory (prevents unbounded growth). */
const MAX_ACTIVITIES = 100;

interface UseAgentActivityResult {
  activities: Activity[];
  isLoading: boolean;
  error: string | null;
  isSubscribed: boolean;
  refetch: () => void;
}

/**
 * Hook to fetch and subscribe to real-time activity for an agent.
 *
 * Uses the shared ActivityStreamContext (single SSE connection) rather than
 * opening a new EventSource per component, avoiding the browser's 6-connection
 * limit when many AgentCards are rendered simultaneously.
 */
export function useAgentActivity(
  agentId: string | null,
): UseAgentActivityResult {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const actorId = agentId ? toActorId(agentId) : null;

  const fetchActivities = useCallback(async () => {
    if (!agentId) {
      setActivities([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/activities?actorId=${encodeURIComponent(actorId!)}&limit=50`,
        { signal: abortControllerRef.current?.signal },
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch activities: ${response.statusText}`);
      }

      const data = await response.json();
      if (data.success && Array.isArray(data.activities)) {
        // Sort by timestamp descending (newest first) and apply memory cap
        const sorted = [...data.activities]
          .sort(
            (a, b) =>
              new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
          )
          .slice(0, MAX_ACTIVITIES);
        setActivities(sorted);
      } else {
        throw new Error("API returned invalid response");
      }
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        setError(err.message);
      }
    } finally {
      setIsLoading(false);
    }
  }, [agentId, actorId]);

  // Receive activities from the shared SSE stream
  const handleActivity = useCallback(
    (activity: Activity) => {
      setActivities((prev) => {
        // Update existing or prepend new, then enforce memory cap
        const exists = prev.some((a) => a.id === activity.id);
        const updated = exists
          ? prev.map((a) => (a.id === activity.id ? activity : a))
          : [activity, ...prev];

        // Keep sorted newest-first and cap at MAX_ACTIVITIES
        return updated
          .sort(
            (a, b) =>
              new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
          )
          .slice(0, MAX_ACTIVITIES);
      });
    },
    [], // no deps — setActivities is stable
  );

  const { connected } = useActivityStream(actorId, handleActivity);

  useEffect(() => {
    abortControllerRef.current = new AbortController();
    fetchActivities();

    return () => {
      abortControllerRef.current?.abort();
    };
  }, [fetchActivities]);

  return {
    activities,
    isLoading,
    error,
    isSubscribed: connected,
    refetch: fetchActivities,
  };
}
