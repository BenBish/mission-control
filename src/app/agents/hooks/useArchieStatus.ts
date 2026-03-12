import { useState, useEffect, useCallback } from "react";

export interface ArchieTaskStatus {
  task_id: string;
  title: string;
  state: string;
  kind?: string;
  branch?: string;
  priority?: string;
  created_at: string;
  updated_at: string;
  linear?: {
    issue_id?: string;
    url?: string | null;
  };
  pr?: {
    number?: number | null;
    url?: string | null;
    head_ref?: string | null;
  };
  result?: {
    summary?: string | null;
    last_error?: string | null;
    blocked_reason?: string | null;
  };
  worker?: {
    session_name?: string;
    started_at?: string;
    last_heartbeat_at?: string;
  };
}

export interface ArchieStatusResponse {
  success: boolean;
  overall_status: "idle" | "working" | "reviewing" | "testing";
  current_task: ArchieTaskStatus | null;
  recent_tasks: ArchieTaskStatus[];
}

const POLL_INTERVAL_MS = 10_000;

export function useArchieStatus() {
  const [data, setData] = useState<ArchieStatusResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/agents/archie/status");
      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.statusText}`);
      }
      const json: ArchieStatusResponse = await response.json();
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  return { data, isLoading, error, refetch: fetchStatus };
}
