/**
 * Activity Stream Hook
 * Manages real-time activity updates via Server-Sent Events (SSE)
 */

import { useEffect, useState, useCallback } from 'react';
import { Activity } from '../../types/activity';

interface UseActivityStreamOptions {
  pollIntervalMs?: number;
  retryIntervalMs?: number;
  maxRetries?: number;
}

export function useActivityStream(
  onNewActivity: (activity: Activity) => void,
  options: UseActivityStreamOptions = {}
) {
  const {
    pollIntervalMs = 5000,
    retryIntervalMs = 3000,
    maxRetries = 5,
  } = options;

  const [isConnected, setIsConnected] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [lastActivityId, setLastActivityId] = useState<string | null>(null);

  // Try to connect via Server-Sent Events first, fall back to polling
  useEffect(() => {
    let eventSource: EventSource | null = null;
    let pollInterval: NodeJS.Timeout | null = null;
    let retryTimeout: NodeJS.Timeout | null = null;
    let lastPollTime = 0;

    const startSSE = () => {
      try {
        console.log('[ActivityStream] Attempting SSE connection...');
        eventSource = new EventSource('/api/stream');

        eventSource.addEventListener('activity', (event: MessageEvent) => {
          try {
            const activity = JSON.parse(event.data);
            console.log('[ActivityStream] Received activity via SSE:', activity.id);
            onNewActivity(activity);
            setLastActivityId(activity.id);
            setIsConnected(true);
            setRetryCount(0);
          } catch (error) {
            console.error('[ActivityStream] Failed to parse SSE activity:', error);
          }
        });

        eventSource.addEventListener('open', () => {
          console.log('[ActivityStream] SSE connection established');
          setIsConnected(true);
          setIsStreaming(true);
          setRetryCount(0);
        });

        eventSource.addEventListener('error', () => {
          console.warn('[ActivityStream] SSE connection error');
          setIsConnected(false);
          setIsStreaming(false);
          eventSource?.close();
          eventSource = null;

          // Retry with exponential backoff
          if (retryCount < maxRetries) {
            setRetryCount((prev) => prev + 1);
            retryTimeout = setTimeout(startSSE, retryIntervalMs * (retryCount + 1));
          } else {
            console.warn('[ActivityStream] Max SSE retries reached, falling back to polling');
            startPolling();
          }
        });
      } catch (error) {
        console.error('[ActivityStream] SSE initialization failed:', error);
        startPolling();
      }
    };

    const startPolling = () => {
      console.log('[ActivityStream] Starting polling mode...');
      setIsStreaming(false);
      setIsConnected(false);

      const pollActivities = async () => {
        try {
          const now = Date.now();
          if (now - lastPollTime < pollIntervalMs) {
            return; // Too soon since last poll
          }
          lastPollTime = now;

          const response = await fetch('/api/activities?limit=10&offset=0');
          if (!response.ok) throw new Error('Poll failed');

          const data = await response.json();
          const activities: Activity[] = data.activities || [];

          // Check for new activities since last poll
          for (const activity of activities) {
            if (lastActivityId === null || activity.id !== lastActivityId) {
              onNewActivity(activity);
              setLastActivityId(activity.id);
              break; // Only process the newest one
            }
          }

          setIsConnected(true);
        } catch (error) {
          console.warn('[ActivityStream] Polling error:', error);
          setIsConnected(false);
        }
      };

      pollInterval = setInterval(pollActivities, pollIntervalMs);
      // Initial poll immediately
      pollActivities();
    };

    // Try SSE first
    startSSE();

    return () => {
      // Cleanup
      if (eventSource) {
        eventSource.close();
      }
      if (pollInterval) {
        clearInterval(pollInterval);
      }
      if (retryTimeout) {
        clearTimeout(retryTimeout);
      }
    };
  }, [onNewActivity, pollIntervalMs, retryIntervalMs, maxRetries, retryCount]);

  return {
    isConnected,
    isStreaming,
    lastActivityId,
  };
}
