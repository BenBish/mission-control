/**
 * usePermissionsMatrix Hook
 * Fetches the permissions matrix from /api/permissions/matrix
 * and maps it to the frontend PermissionsMatrixData type.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type {
  PermissionsMatrixData,
  PermissionsMatrixResponse,
} from "@/types/permissions";

interface UsePermissionsMatrixReturn {
  data: PermissionsMatrixData | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function usePermissionsMatrix(): UsePermissionsMatrixReturn {
  const [data, setData] = useState<PermissionsMatrixData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchMatrix = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/permissions/matrix", { signal });

      if (!response.ok) {
        throw new Error(
          `Failed to fetch permissions matrix: ${response.statusText}`
        );
      }

      const raw: PermissionsMatrixResponse = await response.json();

      if (!raw.success) {
        throw new Error("API returned unsuccessful response");
      }

      // Map to frontend types (strip unneeded fields)
      const mapped: PermissionsMatrixData = {
        agents: raw.agents.map((a) => ({
          id: a.id,
          name: a.name,
          role: a.role,
        })),
        skills: raw.skills.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
        })),
        matrix: raw.matrix,
      };

      setData(mapped);
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        setError(err.message);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  const refetch = useCallback(() => {
    // Abort any in-flight request before starting a new one
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    fetchMatrix(controller.signal);
  }, [fetchMatrix]);

  useEffect(() => {
    const controller = new AbortController();
    abortControllerRef.current = controller;
    fetchMatrix(controller.signal);
    return () => controller.abort();
  }, [fetchMatrix]);

  return {
    data,
    isLoading,
    error,
    refetch,
  };
}
