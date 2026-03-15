import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api-client";

interface DailyStat {
  date: string;
  activities: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  cost: number;
  tokens: number;
}

interface UseDailyStatsResult {
  data: DailyStat[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useDailyStats(
  profileId?: string,
  days = 30,
): UseDailyStatsResult {
  const [data, setData] = useState<DailyStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (profileId) params.set("profile", profileId);
      params.set("days", String(days));
      const res = await apiFetch(`/api/stats/daily?${params}`);
      if (!res.ok)
        throw new Error(`Failed to fetch daily stats: ${res.statusText}`);
      const json = await res.json();
      if (json.success) {
        setData(json.days);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [profileId, days]);

  useEffect(() => {
    setLoading(true);
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}
