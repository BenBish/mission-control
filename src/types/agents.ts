/**
 * Agent and Skill Types
 * Interfaces for agents, skills, and permissions management
 */

export interface Agent {
  id: string;
  name: string;
  role: string;
  model: string;
  gitAuthorName?: string;
  gitAuthorEmail?: string;
  skills: string[];
  status?: 'online' | 'offline' | 'busy' | 'idle';
  lastActive?: string;
  sessionCount?: number;
  totalCost?: number;
  totalTokens?: number;
}

export interface AgentStats {
  lastActive: string | null;
  sessionCount: number;
  totalCost: number;
  totalTokens: number;
  pendingCount: number;
}

export interface AgentConfig {
  id: string;
  name: string;
  model: string;
  role: string;
  gitAuthorName: string;
  gitAuthorEmail: string;
  allowedSkills?: string[];
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  location: string;
  agents?: Agent[];
  category?: string;
}

export interface SkillConfig {
  id: string;
  name: string;
  description: string;
}

export interface PermissionsMatrix {
  agents: Agent[];
  skills: Skill[];
  matrix: boolean[][]; // agents × skills
}

/**
 * Agent activity record from database
 */
export interface AgentActivity {
  id: string;
  sessionId: string;
  timestamp: string;
  actionType: string;
  description: string;
  status: string;
  toolName?: string;
  tokens?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    model?: string;
  };
  cost?: {
    usd: number;
  };
}

/**
 * Parsed SOUL.md metadata
 */
export interface SoulMetadata {
  role: string;
  model?: string;
  gitAuthorName?: string;
  gitAuthorEmail?: string;
  name?: string;
}
