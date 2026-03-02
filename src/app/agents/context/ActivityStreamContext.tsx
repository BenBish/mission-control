/**
 * ActivityStreamContext — single shared SSE connection for all agent components.
 *
 * Problem solved: Each AgentCard previously opened its own EventSource("/api/stream"),
 * exhausting the browser's 6-connection-per-host limit with 7+ agents.
 *
 * Solution: One EventSource at the app root; consumers call useActivityStream()
 * and receive only events matching their agentId filter.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Activity } from "@/types/activity";
import { useProfile } from "@/app/profile-context";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ActivityStreamContextValue {
  /** Subscribe to activities for a specific actor. Returns an unsubscribe fn. */
  subscribe: (
    actorId: string,
    handler: (activity: Activity) => void,
  ) => () => void;
  /** Whether the SSE connection is currently open */
  connected: boolean;
}

// ─── Context ─────────────────────────────────────────────────────────────────

const ActivityStreamContext = createContext<ActivityStreamContextValue | null>(
  null,
);

// ─── Provider ─────────────────────────────────────────────────────────────────

const BACKOFF_DELAYS_MS = [3_000, 6_000, 12_000];

interface ActivityStreamProviderProps {
  children: ReactNode;
}

export function ActivityStreamProvider({
  children,
}: ActivityStreamProviderProps) {
  const { activeProfile } = useProfile();
  const profileId = activeProfile?.id;
  const [connected, setConnected] = useState(false);

  // Map of actorId → Set of handlers
  const handlersRef = useRef<Map<string, Set<(activity: Activity) => void>>>(
    new Map(),
  );
  const eventSourceRef = useRef<EventSource | null>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);
  const connectRef = useRef<() => void>(() => {});

  const connect = useCallback(() => {
    if (unmountedRef.current) return;

    // Clean up any existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    const streamUrl = profileId
      ? `/api/stream?profile=${encodeURIComponent(profileId)}`
      : "/api/stream";
    const es = new EventSource(streamUrl);
    eventSourceRef.current = es;

    es.addEventListener("open", () => {
      if (unmountedRef.current) return;
      retryCountRef.current = 0;
      setConnected(true);
    });

    es.addEventListener("activity", (event) => {
      if (unmountedRef.current) return;
      try {
        const activity: Activity = JSON.parse(event.data);
        const actorId = activity.actor.id;

        // Dispatch to subscribers for this actor
        const handlers = handlersRef.current.get(actorId);
        if (handlers) {
          handlers.forEach((handler) => handler(activity));
        }
      } catch (err) {
        console.error("[ActivityStream] Error parsing SSE event:", err);
      }
    });

    es.addEventListener("error", () => {
      if (unmountedRef.current) return;

      setConnected(false);
      es.close();
      eventSourceRef.current = null;

      // Exponential backoff retry
      const attempt = retryCountRef.current;
      const delayMs =
        BACKOFF_DELAYS_MS[Math.min(attempt, BACKOFF_DELAYS_MS.length - 1)];
      retryCountRef.current += 1;

      console.warn(
        `[ActivityStream] SSE error — retrying in ${delayMs / 1000}s (attempt ${attempt + 1})`,
      );

      retryTimerRef.current = setTimeout(() => {
        if (!unmountedRef.current) connectRef.current();
      }, delayMs);
    });
  }, [profileId]); // reconnect when profile changes

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    unmountedRef.current = false;
    connect();

    return () => {
      unmountedRef.current = true;
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [connect]);

  const subscribe = useCallback(
    (actorId: string, handler: (activity: Activity) => void) => {
      const map = handlersRef.current;
      if (!map.has(actorId)) {
        map.set(actorId, new Set());
      }
      map.get(actorId)!.add(handler);

      return () => {
        const handlers = map.get(actorId);
        if (handlers) {
          handlers.delete(handler);
          if (handlers.size === 0) {
            map.delete(actorId);
          }
        }
      };
    },
    [],
  );

  return (
    <ActivityStreamContext.Provider value={{ subscribe, connected }}>
      {children}
    </ActivityStreamContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Subscribe to the shared SSE stream, filtered by actorId.
 *
 * @param actorId  The actor ID to filter events for (already translated,
 *                 e.g. 'engineer' not 'workspace-engineer').
 * @param onActivity  Called for each matching activity event.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useActivityStream(
  actorId: string | null,
  onActivity: (activity: Activity) => void,
): { connected: boolean } {
  const ctx = useContext(ActivityStreamContext);

  if (!ctx) {
    throw new Error(
      "useActivityStream must be used within <ActivityStreamProvider>",
    );
  }

  const { subscribe, connected } = ctx;

  // Keep a stable ref to the latest callback so we don't re-subscribe on every render
  const onActivityRef = useRef(onActivity);
  useEffect(() => {
    onActivityRef.current = onActivity;
  }, [onActivity]);

  useEffect(() => {
    if (!actorId) return;

    const unsubscribe = subscribe(actorId, (activity) => {
      onActivityRef.current(activity);
    });

    return unsubscribe;
  }, [actorId, subscribe]);

  return { connected };
}
