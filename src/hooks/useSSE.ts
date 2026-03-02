/**
 * useSSE — Profile-scoped Server-Sent Events hook.
 *
 * Connects to `/api/stream?profile=<profileId>` and dispatches typed events
 * (`system`, `activity`, `activity_update`, `profile_status`) to the caller.
 *
 * When `profileId` changes the old EventSource is closed and a new one opens,
 * ensuring the client only ever receives events for the active profile.
 *
 * Uses the browser's built-in EventSource reconnection for network interruptions,
 * which automatically preserves the `?profile=` query parameter.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import type { Activity } from "@/types/activity";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SSESystemEvent {
  type: "connected" | "heartbeat";
  profile?: string;
}

export interface SSEHandlers {
  onActivity?: (activity: Activity) => void;
  onActivityUpdate?: (data: unknown) => void;
  onProfileStatus?: (data: unknown) => void;
  onSystem?: (event: SSESystemEvent) => void;
  onError?: (error: Event) => void;
}

export interface UseSSEResult {
  /** Whether the SSE connection is currently open */
  connected: boolean;
  /** The profile this SSE connection is scoped to */
  profileId: string;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useSSE(profileId: string, handlers: SSEHandlers = {}): UseSSEResult {
  const [connected, setConnected] = useState(false);

  // Keep stable refs to handlers so we don't re-create EventSource on every render
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    const es = new EventSource(`/api/stream?profile=${encodeURIComponent(profileId)}`);

    es.addEventListener("open", () => {
      setConnected(true);
    });

    es.addEventListener("system", (event: MessageEvent) => {
      try {
        const data: SSESystemEvent = JSON.parse(event.data);
        handlersRef.current.onSystem?.(data);
      } catch {
        // Ignore malformed system events
      }
    });

    es.addEventListener("activity", (event: MessageEvent) => {
      try {
        const activity: Activity = JSON.parse(event.data);
        handlersRef.current.onActivity?.(activity);
      } catch {
        // Ignore malformed activity events
      }
    });

    es.addEventListener("activity_update", (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        handlersRef.current.onActivityUpdate?.(data);
      } catch {
        // Ignore malformed events
      }
    });

    es.addEventListener("profile_status", (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        handlersRef.current.onProfileStatus?.(data);
      } catch {
        // Ignore malformed events
      }
    });

    es.addEventListener("error", (event: Event) => {
      setConnected(false);
      handlersRef.current.onError?.(event);
    });

    return () => {
      es.close();
      setConnected(false);
    };
  }, [profileId]);

  return { connected, profileId };
}
