/**
 * useSkills Hook
 * Fetch skills from the backend API
 */

import { useState, useEffect, useCallback } from "react";
import type { Skill, SkillsResponse } from "@/types/skills";
import { apiFetch } from "@/lib/api-client";

interface UseSkillsReturn {
  skills: Skill[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useSkills(profileId?: string): UseSkillsReturn {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSkills = useCallback(
    async (signal?: AbortSignal) => {
      setIsLoading(true);
      setError(null);

      const profileParam = profileId
        ? `?profile=${encodeURIComponent(profileId)}`
        : "";

      try {
        const skillsRes = await apiFetch(`/api/skills${profileParam}`, {
          signal,
        });

        if (!skillsRes.ok) {
          throw new Error(`Failed to fetch skills: ${skillsRes.statusText}`);
        }

        const skillsData: SkillsResponse = await skillsRes.json();

        if (!skillsData.success || !Array.isArray(skillsData.skills)) {
          throw new Error("Skills API returned unsuccessful response");
        }

        setSkills(skillsData.skills);
      } catch (err) {
        if (err instanceof Error && err.name !== "AbortError") {
          setError(err.message);
        }
      } finally {
        setIsLoading(false);
      }
    },
    [profileId],
  );

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
