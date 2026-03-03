import { useState, useEffect, useCallback, useRef } from "react";
import type { Profile } from "@/types/profile";
import { apiFetch } from "@/lib/api-client";

const POLL_INTERVAL_MS = 30_000;

interface UseProfilesResult {
  profiles: Profile[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useProfiles(): UseProfilesResult {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchProfiles = useCallback(async (signal?: AbortSignal) => {
    setError(null);
    try {
      const response = await apiFetch("/api/profiles", { signal });
      if (!response.ok) {
        throw new Error(`Failed to fetch profiles: ${response.statusText}`);
      }
      const data = await response.json();
      if (data.success && Array.isArray(data.profiles)) {
        setProfiles(data.profiles);
      } else {
        throw new Error("Profiles API returned unsuccessful response");
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Failed to fetch profiles");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchProfiles(controller.signal);

    intervalRef.current = setInterval(() => {
      fetchProfiles();
    }, POLL_INTERVAL_MS);

    return () => {
      controller.abort();
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [fetchProfiles]);

  return {
    profiles,
    isLoading,
    error,
    refetch: fetchProfiles,
  };
}
