/**
 * useSkills Hook
 * Fetch and manage skills data from API
 */

import { useState, useEffect, useRef, useCallback } from "react";
import type { Skill, SkillsResponse } from "@/types/skills";

interface UseSkillsOptions {
  category?: string;
  search?: string;
}

interface UseSkillsReturn {
  skills: Skill[];
  categories: string[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useSkills(options: UseSkillsOptions = {}): UseSkillsReturn {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Use ref to track if component is mounted
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  // Shared fetch logic
  const performFetch = useCallback(async (signal?: AbortSignal) => {
    if (!isMounted.current) return;

    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (options.category) params.set("category", options.category);
      if (options.search) params.set("search", options.search);

      const fetchOptions = signal ? { signal } : {};
      const response = await fetch(`/api/skills?${params.toString()}`, fetchOptions);

      if (!response.ok) {
        throw new Error(`Failed to fetch skills: ${response.statusText}`);
      }

      const data: SkillsResponse = await response.json();

      // Runtime validation before type assertion
      if (!data || typeof data !== 'object') {
        throw new Error('Invalid response format');
      }

      if (data.success) {
        const skillsData = data.skills;
        if (!Array.isArray(skillsData)) {
          throw new Error('Invalid skills data: expected array');
        }
        if (isMounted.current) {
          setSkills(skillsData);
          setCategories(data.categories || []);
        }
      } else {
        throw new Error("API returned unsuccessful response");
      }
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        if (isMounted.current) {
          setError(err.message);
        }
      }
    } finally {
      if (isMounted.current) {
        setIsLoading(false);
      }
    }
  }, [options.category, options.search]);

  // useEffect with primitive deps only to avoid infinite loops
  useEffect(() => {
    const controller = new AbortController();
    performFetch(controller.signal);
    return () => controller.abort();
  }, [performFetch]);

  return {
    skills,
    categories,
    isLoading,
    error,
    refetch: performFetch,
  };
}
