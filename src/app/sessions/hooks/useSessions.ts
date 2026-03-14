import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api-client";
import type { SessionSummary } from "@/types/activity";

export interface SessionRow {
  id: string;
  profile_id: string;
  start_time: string;
  end_time: string | null;
  total_actions: number;
  success_count: number;
  failure_count: number;
  total_tokens: number;
  total_cost_usd: number;
  avg_action_duration_ms: number;
  actors_json: string | null;
  top_tools_json: string | null;
}

interface UseSessionsResult {
  sessions: SessionRow[];
  total: number;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useSessions(
  profileId?: string,
  limit = 50,
  offset = 0,
): UseSessionsResult {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        limit: String(limit),
        offset: String(offset),
      });
      if (profileId) params.set("profile", profileId);
      const response = await apiFetch(`/api/sessions?${params}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch sessions: ${response.statusText}`);
      }
      const data = await response.json();
      if (data.success) {
        setSessions(data.sessions);
        setTotal(data.total);
      } else {
        throw new Error("API returned unsuccessful response");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error occurred");
    } finally {
      setIsLoading(false);
    }
  }, [profileId, limit, offset]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  return { sessions, total, isLoading, error, refetch: fetchSessions };
}

interface UseSessionResult {
  session: SessionSummary | null;
  isLoading: boolean;
  error: string | null;
}

export function useSession(
  sessionId: string,
  profileId?: string,
): UseSessionResult {
  const [session, setSession] = useState<SessionSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const abortController = new AbortController();
    let isMounted = true;

    const fetchSession = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const params = profileId
          ? `?profile=${encodeURIComponent(profileId)}`
          : "";
        const response = await apiFetch(`/api/sessions/${sessionId}${params}`, {
          signal: abortController.signal,
        });
        if (!response.ok) {
          throw new Error(`Failed to fetch session: ${response.statusText}`);
        }
        const data = await response.json();
        if (isMounted && !abortController.signal.aborted) {
          if (data.success) {
            setSession(data.summary);
          } else {
            throw new Error("API returned unsuccessful response");
          }
        }
      } catch (err) {
        if (isMounted && !abortController.signal.aborted) {
          setError(
            err instanceof Error ? err.message : "Unknown error occurred",
          );
        }
      } finally {
        if (isMounted && !abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    if (sessionId) {
      fetchSession();
    }

    return () => {
      isMounted = false;
      abortController.abort();
    };
  }, [sessionId, profileId]);

  return { session, isLoading, error };
}
