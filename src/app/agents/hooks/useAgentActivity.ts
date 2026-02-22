import { useState, useEffect, useCallback, useRef } from "react";
import type { Activity } from "@/types/activity";

interface UseAgentActivityResult {
  activities: Activity[];
  isLoading: boolean;
  error: string | null;
  isSubscribed: boolean;
  refetch: () => void;
}

/**
 * Translates workspace-prefixed agent IDs to short IDs used in the database
 * Examples:
 * - 'workspace-engineer' → 'engineer'
 * - 'workspace' → 'main'
 * - 'engineer' → 'engineer' (pass-through)
 */
function toActorId(id: string): string {
  if (id === 'workspace') return 'main';
  if (id.startsWith('workspace-')) return id.slice('workspace-'.length);
  return id;
}

/**
 * Hook to fetch and subscribe to real-time activity for an agent
 * Combines initial fetch with SSE subscription for live updates
 */
export function useAgentActivity(agentId: string | null): UseAgentActivityResult {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchActivities = useCallback(async () => {
    if (!agentId) {
      setActivities([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const actorId = toActorId(agentId);
      const response = await fetch(
        `/api/activities?actorId=${encodeURIComponent(actorId)}&limit=50`,
        { signal: abortControllerRef.current?.signal }
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch activities: ${response.statusText}`);
      }

      const data = await response.json();
      if (data.success && Array.isArray(data.activities)) {
        // Sort by timestamp descending (most recent first)
        const sorted = [...data.activities].sort(
          (a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
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
  }, [agentId]);

  useEffect(() => {
    // Initial fetch
    fetchActivities();

    if (!agentId) {
      return;
    }

    // Subscribe to SSE for real-time updates
    try {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      const eventSource = new EventSource("/api/stream");
      eventSourceRef.current = eventSource;
      setIsSubscribed(true);

      eventSource.addEventListener("activity", (event) => {
        try {
          const activity: Activity = JSON.parse(event.data);

          // Only process activities from this agent
          if (activity.actor.id === toActorId(agentId)) {
            setActivities((prev) => {
              // Check if activity already exists
              const exists = prev.some((a) => a.id === activity.id);
              if (exists) {
                // Update existing activity
                return prev
                  .map((a) => (a.id === activity.id ? activity : a))
                  .sort(
                    (a, b) =>
                      new Date(b.timestamp).getTime() -
                      new Date(a.timestamp).getTime()
                  );
              } else {
                // Add new activity and keep sorted
                return [activity, ...prev].sort(
                  (a, b) =>
                    new Date(b.timestamp).getTime() -
                    new Date(a.timestamp).getTime()
                );
              }
            });
          }
        } catch (err) {
          console.error("Error parsing SSE activity:", err);
        }
      });

      eventSource.addEventListener("error", () => {
        console.error("SSE connection error");
        setIsSubscribed(false);
      });
    } catch (err) {
      console.error("Failed to subscribe to SSE:", err);
      setIsSubscribed(false);
    }

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [agentId, fetchActivities]);

  return {
    activities,
    isLoading,
    error,
    isSubscribed,
    refetch: fetchActivities,
  };
}
