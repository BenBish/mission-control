/**
 * Frontend Agent types. For backend service types see types/agents.ts.
 * Keep both files in sync when adding fields to the API response.
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
  skills?: string[];
  gitAuthorName?: string;
  gitAuthorEmail?: string;
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
    skills?: string[];
  };
}

export interface WorkspaceFile {
  name: string;
  size: number;
  modifiedAt: string;
  type: "markdown" | "json";
}

export interface AgentFilesResponse {
  success: boolean;
  workspacePath: string;
  files: WorkspaceFile[];
}

export interface AgentFileContentResponse {
  success: boolean;
  content: string;
  name: string;
  type: "markdown" | "json";
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
