/**
 * Permissions Matrix Types
 * Types for the Agent × Skill permissions matrix visualization
 */

export interface PermissionAgent {
  id: string;
  name: string;
  role: string;
}

export interface PermissionSkill {
  id: string;
  name: string;
  description: string;
}

export interface PermissionsMatrixData {
  agents: PermissionAgent[];
  skills: PermissionSkill[];
  matrix: boolean[][];
}

export interface PermissionsMatrixResponse {
  success: boolean;
  agents: Array<{
    id: string;
    name: string;
    role: string;
    model: string;
    skills: string[];
    status?: "online" | "offline" | "busy" | "idle";
    lastActive?: string;
    sessionCount?: number;
    totalCost?: number;
    totalTokens?: number;
  }>;
  skills: Array<{
    id: string;
    name: string;
    description: string;
    location?: string;
  }>;
  matrix: boolean[][];
}
