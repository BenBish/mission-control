/**
 * Core Activity Record Types
 *
 * ActionType/ActivityStatus are source-agnostic and predate this rebuild —
 * kept verbatim. ActorType drops the OpenClaw-specific "orchestrator" role
 * in favor of "agent" (the AI actor, regardless of source), since Claude
 * Code and Codex have no orchestrator/subagent hierarchy of their own
 * outside of Claude Code's sidechain delegation.
 */

export type ActorType = "user" | "agent" | "subagent" | "system";
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
}

export interface ExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
  exitCode?: number;
}

export interface Activity {
  id: string;
  sourceId: string;
  instanceId: string;
  sessionId: string;
  externalId?: string;
  parentActivityId?: string;
  parentExternalId?: string;

  timestamp: string; // ISO8601
  completedAt?: string;
  durationMs?: number;

  actor: Actor;

  actionType: ActionType;
  toolName?: string;
  description: string;
  details?: Record<string, unknown>;

  status: ActivityStatus;
  result?: ExecutionResult;

  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  model?: string;
  /** Only set for genuinely billable sources. Never fabricate a dollar figure. */
  costUsd?: number;
  requestId?: string;

  tags?: string[];
  metadata?: Record<string, unknown>;

  createdAt?: string;
}

export interface SessionSummary {
  sessionId: string;
  sourceId: string;
  instanceId: string;
  externalId: string;
  cwd?: string;
  gitBranch?: string;
  title?: string;
  startTime: string;
  endTime?: string;

  stats: {
    turnCount: number;
    toolCallCount: number;
    failureCount: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    costUsd?: number;
  };

  activities: Activity[];
}

/**
 * Query filters for activity retrieval
 */
export interface ActivityFilter {
  sourceId?: string;
  sessionId?: string;
  actorId?: string;
  actorType?: ActorType;
  actionType?: ActionType;
  toolName?: string;
  status?: ActivityStatus;
  startTime?: string;
  endTime?: string;
  limit?: number;
  offset?: number;
}
