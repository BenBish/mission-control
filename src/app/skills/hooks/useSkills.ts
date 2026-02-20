/**
 * useSkills Hook
 * Fetch and manage skills data from API
 */

import { useState, useEffect, useCallback } from "react";
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

  const fetchSkills = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const params = new URLSearchParams();
      if (options.category) params.set("category", options.category);
      if (options.search) params.set("search", options.search);
      
      const response = await fetch(`/api/skills?${params.toString()}`);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch skills: ${response.statusText}`);
      }
      
      const data: SkillsResponse = await response.json();
      
      if (data.success) {
        setSkills(data.skills);
        setCategories(data.categories || []);
      } else {
        throw new Error("API returned unsuccessful response");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error occurred");
    } finally {
      setIsLoading(false);
    }
  }, [options.category, options.search]);

  useEffect(() => {
    fetchSkills();
  }, [fetchSkills]);

  return {
    skills,
    categories,
    isLoading,
    error,
    refetch: fetchSkills,
  };
}
