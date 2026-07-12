/**
 * useSSE — Server-Sent Events hook.
 *
 * Connects to `/api/stream`, a single global broadcast (profiles are gone —
 * there's nothing to scope the connection by anymore; callers filter
 * client-side by sourceId the same way they filter the REST list endpoints).
 *
 * Uses the browser's built-in EventSource reconnection for network
 * interruptions.
 */

import { useEffect, useRef, useState } from "react";
import type { Activity } from "@/types/activity";
import { apiUrl } from "@/lib/api-client";

export interface SSESystemEvent {
  type: "connected" | "heartbeat";
}

export interface SSEHandlers {
  onActivity?: (activity: Activity) => void;
  onSystem?: (event: SSESystemEvent) => void;
  onError?: (error: Event) => void;
}

export interface UseSSEResult {
  connected: boolean;
}

export function useSSE(handlers: SSEHandlers = {}): UseSSEResult {
  const [connected, setConnected] = useState(false);

  // Keep a stable ref to handlers so we don't re-create EventSource on every render
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    const es = new EventSource(apiUrl("/api/stream"));

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

    es.addEventListener("error", (event: Event) => {
      setConnected(false);
      handlersRef.current.onError?.(event);
    });

    return () => {
      es.close();
      setConnected(false);
    };
  }, []);

  return { connected };
}
