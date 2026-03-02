import { useState, useEffect, useCallback, useRef } from "react";
import type { Profile } from "@/types/profile";

const POLL_INTERVAL_MS = 30_000;

// Mock data for development before ORC-46 merges
const mockProfiles: Profile[] = [
  {
    id: "team",
    name: "Orca Team",
    gatewayUrl: "http://127.0.0.1:18890",
    status: "online",
    agentCount: 7,
    lastActivity: "2026-02-27T00:00:00Z",
  },
  {
    id: "default",
    name: "Default",
    gatewayUrl: "http://127.0.0.1:18789",
    status: "online",
    agentCount: 1,
    lastActivity: "2026-02-27T00:00:00Z",
  },
];

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
      const response = await fetch("/api/profiles", { signal });
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
      // Fall back to mock data when API is not available (ORC-46 not yet merged)
      console.warn("[useProfiles] API unavailable, using mock profiles:", err);
      setProfiles(mockProfiles);
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
