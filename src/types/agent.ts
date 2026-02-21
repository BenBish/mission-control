/**
 * Agent Types
 */

export interface Agent {
  id: string;
  name: string;
  role: string;
  model: string;
  status: "online" | "offline" | "busy" | "idle";
  lastActive: string;
  sessionCount: number;
  totalCost: number;
  totalTokens: number;
}

export interface AgentsResponse {
  success: boolean;
  count: number;
  agents: Agent[];
}
