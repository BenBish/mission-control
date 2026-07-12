/**
 * Skill Types
 */

export interface Skill {
  id: string;
  name: string;
  description: string;
  category?: string;
}

export interface SkillsResponse {
  success: boolean;
  count: number;
  skills: Skill[];
}
