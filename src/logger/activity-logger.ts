/**
 * Activity Logger
 * Central module for logging all tool executions and agent actions
 * This is the instrumentation layer that captures every action
 */

import { EventEmitter } from 'events';
import { Database } from '../db/database.js';
import { Activity, CreateActivityInput, UpdateActivityInput, TokenInfo } from '../types/activity.js';
import { calculateCost } from '../types/pricing.js';

export class ActivityLogger extends EventEmitter {
  private pendingActivities: Map<string, Activity> = new Map();
  private sessionStarts: Map<string, string> = new Map();

  constructor(private db: Database) {
    super();
  }

  /**
   * Log start of a session
   */
  async logSessionStart(sessionId: string): Promise<string> {
    const activity = await this.log({
      sessionId,
      actor: {
        type: 'system',
        id: 'mission-control',
      },
      actionType: 'session_start',
      description: `Session started: ${sessionId}`,
    });

    await this.db.createSession(sessionId);
    this.sessionStarts.set(sessionId, new Date().toISOString());

    return activity.id;
  }

  /**
   * Log end of a session
   */
  async logSessionEnd(sessionId: string): Promise<string> {
    const startTime = this.sessionStarts.get(sessionId);
    const endTime = new Date().toISOString();

    const activity = await this.log({
      sessionId,
      actor: {
        type: 'system',
        id: 'mission-control',
      },
      actionType: 'session_end',
      description: `Session ended: ${sessionId}`,
    });

    await this.db.updateSession(sessionId, endTime);
    this.sessionStarts.delete(sessionId);

    return activity.id;
  }

  /**
   * Log a tool execution start
   * Returns an activity ID that should be used for subsequent updates
   */
  async logToolStart(
    sessionId: string,
    actor: any,
    toolName: string,
    details: Record<string, any>,
    description: string
  ): Promise<string> {
    const activity = await this.log({
      sessionId,
      actor,
      actionType: 'tool_call',
      toolName,
      description,
      details,
      tags: ['tool-execution'],
    });

    return activity.id;
  }

  /**
   * Log completion of a tool execution
   */
  async logToolEnd(
    activityId: string,
    status: 'success' | 'failure' | 'partial',
    result: any,
    output?: string,
    error?: string,
    durationMs?: number
  ): Promise<void> {
    const activity = this.pendingActivities.get(activityId);
    if (!activity) {
      console.warn(`Activity ${activityId} not found in pending map`);
      return;
    }

    const completedAt = new Date().toISOString();
    const elapsed = durationMs || Date.now() - new Date(activity.timestamp).getTime();

    await this.db.updateActivity(activityId, {
      status,
      completedAt,
      durationMs: elapsed,
      result: {
        success: status === 'success',
        output: output?.substring(0, 5000),
        error,
      },
    });

    this.pendingActivities.delete(activityId);

    // Emit completion event
    this.emit('activity:complete', { id: activityId, status });
  }

  /**
   * Log tool execution with token and cost information
   */
  async logToolWithTokens(
    activityId: string,
    tokens: TokenInfo,
    status: 'success' | 'failure' | 'partial' = 'success'
  ): Promise<void> {
    const cost = calculateCost(tokens.model, tokens.inputTokens, tokens.outputTokens);

    await this.db.updateActivity(activityId, {
      tokens,
      cost: {
        usd: cost,
        breakdown: {
          inputCost: (tokens.inputTokens / 1000) * (tokens.model ? 0.0008 : 0),
          outputCost: (tokens.outputTokens / 1000) * (tokens.model ? 0.004 : 0),
        },
      },
    });

    // Emit cost event for dashboard
    this.emit('activity:cost', {
      id: activityId,
      cost: cost,
      tokens: tokens.totalTokens,
    });
  }

  /**
   * Log a delegation event
   */
  async logDelegation(
    sessionId: string,
    parentActivityId: string | undefined,
    actor: any,
    targetAgent: string,
    description: string
  ): Promise<string> {
    const activity = await this.log({
      sessionId,
      parentActivityId,
      actor,
      actionType: 'delegation',
      description: description || `Delegated to ${targetAgent}`,
      details: { targetAgent },
      tags: ['delegation'],
    });
    return activity.id;
  }

  /**
   * Log an agent spawn
   */
  async logAgentSpawn(
    sessionId: string,
    parentActivityId: string | undefined,
    agentId: string,
    agentRole: string
  ): Promise<string> {
    const activity = await this.log({
      sessionId,
      parentActivityId,
      actor: {
        type: 'system',
        id: 'mission-control',
      },
      actionType: 'agent_spawn',
      description: `Spawned agent: ${agentId} (${agentRole})`,
      details: { agentId, agentRole },
      tags: ['agent-lifecycle'],
    });
    return activity.id;
  }

  /**
   * Log a user request
   */
  async logUserRequest(
    sessionId: string,
    userId: string,
    request: string
  ): Promise<string> {
    const activity = await this.log({
      sessionId,
      actor: {
        type: 'user',
        id: userId,
      },
      actionType: 'user_request',
      description: `User requested: ${request}`,
      tags: ['user-input'],
    });
    return activity.id;
  }

  /**
   * Log an API call
   */
  async logApiCall(
    sessionId: string,
    actor: any,
    endpoint: string,
    method: string,
    statusCode?: number
  ): Promise<string> {
    const activity = await this.log({
      sessionId,
      actor,
      actionType: 'api_call',
      description: `${method} ${endpoint}`,
      details: { endpoint, method, statusCode },
      tags: ['api'],
    });
    return activity.id;
  }

  /**
   * Log a message event (inter-agent or user messaging)
   */
  async logMessage(
    sessionId: string,
    actor: any,
    target: string,
    message: string
  ): Promise<string> {
    const activity = await this.log({
      sessionId,
      actor,
      actionType: 'message',
      description: `Message to ${target}: ${message.substring(0, 100)}`,
      details: { target, message },
      tags: ['messaging'],
    });
    return activity.id;
  }

  /**
   * Core logging method
   * Creates an activity record in the database
   */
  private async log(input: CreateActivityInput): Promise<Activity> {
    const activity = await this.db.createActivity(input);

    // Track pending activities for later updates
    if (activity.status === 'pending') {
      this.pendingActivities.set(activity.id, activity);
    }

    // Emit creation event for real-time dashboard
    this.emit('activity:created', activity);

    return activity;
  }

  /**
   * Get activity by ID
   */
  async getActivity(id: string): Promise<Activity | null> {
    return this.db.getActivity(id);
  }

  /**
   * Get all pending activities
   */
  getPendingActivities(): Activity[] {
    return Array.from(this.pendingActivities.values());
  }

  /**
   * Get session activities
   */
  async getSessionActivities(sessionId: string): Promise<Activity[]> {
    return this.db.getSessionActivities(sessionId);
  }

  /**
   * Get session summary
   */
  async getSessionSummary(sessionId: string) {
    return this.db.getSessionSummary(sessionId);
  }
}
