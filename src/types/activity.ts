/**
 * Core Activity Record Types
 * Implements the data model from MISSION_CONTROL_DESIGN.md
 */

export type ActorType = "orchestrator" | "subagent" | "user" | "system";
export type ActionType =
  | "tool_call"
  | "delegation"
  | "api_call"
  | "decision"
  | "message"
  | "event"
  | "user_request"
  | "agent_spawn"
  | "session_start"
  | "session_end";
export type ActivityStatus = "pending" | "success" | "failure" | "partial";

export interface Actor {
  type: ActorType;
  id: string;
  role?: string;
  sessionLabel?: string;
  displayName?: string;
  emoji?: string;
}

export interface TokenInfo {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  model?: string;
}

export interface CostInfo {
  usd: number;
  breakdown?: {
    inputCost: number;
    outputCost: number;
  };
}

export interface ExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
  exitCode?: number;
}

export interface ActivityReferences {
  fileIds?: string[];
  channelId?: string;
  messageIds?: string[];
}

export interface Activity {
  // Identifiers
  id: string;
  sessionId: string;
  parentActivityId?: string;

  // Timeline
  timestamp: string; // ISO8601
  completedAt?: string; // ISO8601
  durationMs?: number;

  // Actor Information
  actor: Actor;

  // Action Details
  actionType: ActionType;
  toolName?: string;
  description: string;
  details?: Record<string, unknown>;

  // Outcome
  status: ActivityStatus;
  result?: ExecutionResult;

  // Resource Usage
  tokens?: TokenInfo;
  cost?: CostInfo;

  // Context & Traceability
  references?: ActivityReferences;

  // Metadata
  tags?: string[];
  metadata?: Record<string, unknown>;

  // Timestamps
  createdAt?: string; // ISO8601
}

/**
 * Activity input for creating new records
 * Most fields are optional to allow flexible logging
 */
export interface CreateActivityInput {
  sessionId: string;
  parentActivityId?: string;
  actor: Actor;
  actionType: ActionType;
  toolName?: string;
  description: string;
  details?: Record<string, unknown>;
  status?: ActivityStatus;
  tags?: string[];
  references?: ActivityReferences;
  metadata?: Record<string, unknown>;
}

/**
 * Activity update for completing pending activities
 */
export interface UpdateActivityInput {
  status?: ActivityStatus;
  completedAt?: string;
  durationMs?: number;
  result?: ExecutionResult;
  tokens?: TokenInfo;
  cost?: CostInfo;
}

/**
 * Session summary computed from activities
 */
export interface SessionSummary {
  sessionId: string;
  startTime: string;
  endTime?: string;

  stats: {
    totalActions: number;
    successCount: number;
    failureCount: number;
    successRate: number;
    totalTokens: number;
    totalCost: number;
    avgActionDuration: number;
  };

  actors: {
    [actorId: string]: {
      name: string;
      actionsCount: number;
      successCount: number;
      tokensUsed: number;
      costUsd: number;
    };
  };

  topTools: Array<{
    name: string;
    count: number;
    cost: number;
  }>;

  events: Array<{
    timestamp: string;
    type: string;
    summary: string;
  }>;
}

/**
 * Query filters for activity retrieval
 */
export interface ActivityFilter {
  sessionId?: string;
  actorId?: string;
  actorType?: ActorType;
  actionType?: ActionType;
  toolName?: string;
  status?: ActivityStatus;
  startTime?: string;
  endTime?: string;
  tags?: string[];
  limit?: number;
  offset?: number;
}
