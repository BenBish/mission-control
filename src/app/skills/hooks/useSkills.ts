/**
 * useSkills Hook
 * Fetch skills from ORC-18 backend API
 */

import { useState, useEffect, useCallback } from "react";
import type { Skill, SkillsResponse } from "@/types/skills";

interface UseSkillsReturn {
  skills: Skill[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useSkills(): UseSkillsReturn {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSkills = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/skills", { signal });

      if (!response.ok) {
        throw new Error(`Failed to fetch skills: ${response.statusText}`);
      }

      const data: SkillsResponse = await response.json();

      if (data.success && Array.isArray(data.skills)) {
        setSkills(data.skills);
      } else {
        throw new Error("API returned unsuccessful response");
      }
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        setError(err.message);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchSkills(controller.signal);
    return () => controller.abort();
  }, [fetchSkills]);

  return {
    skills,
    isLoading,
    error,
    refetch: fetchSkills,
  };
}
