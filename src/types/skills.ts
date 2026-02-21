/**
 * Skill Types
 */

export interface Skill {
  id: string;
  name: string;
  description: string;
}

export interface SkillsResponse {
  success: boolean;
  count: number;
  skills: Skill[];
}
