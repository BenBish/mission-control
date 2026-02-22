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

export interface AgentDetail extends Agent {
  soulMarkdown?: string;
  config?: {
    workspace?: string;
    model?: string;
    gitConfig?: {
      author?: string;
      email?: string;
    };
    identity?: {
      name?: string;
      emoji?: string;
    };
  };
}

export interface AgentsResponse {
  success: boolean;
  count: number;
  agents: Agent[];
}

export interface AgentDetailResponse {
  success: boolean;
  agent: AgentDetail;
}
