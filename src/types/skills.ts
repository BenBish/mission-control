/**
 * Skill and Agent Types
 */

export interface Skill {
  id: string;
  name: string;
  description: string;
  category: string;
  location?: string;
  agentIds: string[];
}

export interface Agent {
  id: string;
  name: string;
  role: string;
}

export interface SkillsResponse {
  success: boolean;
  skills: Skill[];
  categories: string[];
}

export interface AgentSkillsResponse {
  success: boolean;
  agentId: string;
  skills: Skill[];
}
