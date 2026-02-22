/**
 * useSkills Hook
 * Fetch skills from ORC-18 backend API with agent access information
 */

import { useState, useEffect, useCallback } from "react";
import type { Skill, SkillsResponse } from "@/types/skills";
import type { Agent } from "@/types/agents";

interface PermissionsMatrixResponse {
  success: boolean;
  agents: Agent[];
  skills: Skill[];
  matrix: boolean[][];
}

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
      // Fetch skills and permissions matrix in parallel
      const [skillsRes, permissionsRes] = await Promise.all([
        fetch("/api/skills", { signal }),
        fetch("/api/permissions/matrix", { signal }),
      ]);

      if (!skillsRes.ok) {
        throw new Error(`Failed to fetch skills: ${skillsRes.statusText}`);
      }

      const skillsData: SkillsResponse = await skillsRes.json();

      if (!skillsData.success || !Array.isArray(skillsData.skills)) {
        throw new Error("Skills API returned unsuccessful response");
      }

      let skillsWithAgents = skillsData.skills;

      // Merge agent access data if permissions endpoint is available
      if (permissionsRes.ok) {
        try {
          const permissionsData: PermissionsMatrixResponse = await permissionsRes.json();
          
          if (permissionsData.success && permissionsData.matrix && permissionsData.agents) {
            // Create a map of skill IDs to agent lists
            const skillAgentsMap = new Map<string, Agent[]>();
            
            // Iterate through permissions matrix to find which agents have access to each skill
            permissionsData.skills.forEach((skill, skillIndex) => {
              const agentsWithAccess: Agent[] = [];
              permissionsData.agents.forEach((agent, agentIndex) => {
                if (permissionsData.matrix[agentIndex]?.[skillIndex]) {
                  agentsWithAccess.push(agent);
                }
              });
              skillAgentsMap.set(skill.id, agentsWithAccess);
            });
            
            // Merge agent data into skills
            skillsWithAgents = skillsData.skills.map(skill => ({
              ...skill,
              agents: skillAgentsMap.get(skill.id) || [],
            }));
          }
        } catch (permErr) {
          console.warn("[useSkills] Failed to fetch or merge permissions matrix:", permErr);
          // Continue with skills only if permissions fetch fails
        }
      }

      setSkills(skillsWithAgents);
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
