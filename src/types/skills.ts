/**
 * Skill Types
 */

import type { Agent } from './agents';

export interface Skill {
  id: string;
  name: string;
  description: string;
  agents?: Agent[];
  category?: string;
}

export interface SkillsResponse {
  success: boolean;
  count: number;
  skills: Skill[];
}
