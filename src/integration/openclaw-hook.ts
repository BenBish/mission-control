/**
 * OpenClaw Integration Hook
 * Module to instrument OpenClaw tool execution and log all activities
 * 
 * This module provides middleware/hooks that can be integrated into OpenClaw's
 * tool executor to automatically capture all tool calls, agent actions, and costs.
 */

import { ActivityLogger } from '../logger/activity-logger.js';

/**
 * Tool execution wrapper that logs before and after tool calls
 */
export interface ToolExecutionContext {
  toolName: string;
  params: Record<string, any>;
  actor: {
    type: 'orchestrator' | 'subagent' | 'user' | 'system';
    id: string;
    role?: string;
  };
  sessionId: string;
}

export interface ToolExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
  exitCode?: number;
  durationMs?: number;
  tokens?: {
    inputTokens: number;
    outputTokens: number;
    model?: string;
  };
}

/**
 * Create a tool execution hook for OpenClaw
 * This wraps any OpenClaw tool call with activity logging
 */
export function createToolExecutionHook(logger: ActivityLogger) {
  return async function executeToolWithLogging(
    context: ToolExecutionContext,
    originalToolFn: (params: Record<string, any>) => Promise<any>
  ): Promise<any> {
    const startTime = Date.now();
    const activityId = await logger.logToolStart(
      context.sessionId,
      context.actor,
      context.toolName,
      context.params,
      `Executing tool: ${context.toolName}`
    );

    try {
      const result = await originalToolFn(context.params);

      const durationMs = Date.now() - startTime;

      // Extract tokens if available in result
      if (result && typeof result === 'object') {
        if ('usage' in result || 'tokens' in result) {
          const tokens = result.usage || result.tokens;
          await logger.logToolWithTokens(activityId, {
            inputTokens: tokens.prompt_tokens || tokens.inputTokens || 0,
            outputTokens: tokens.completion_tokens || tokens.outputTokens || 0,
            totalTokens:
              (tokens.prompt_tokens || tokens.inputTokens || 0) +
              (tokens.completion_tokens || tokens.outputTokens || 0),
            model: context.actor.id, // TODO: extract model from context
          });
        }
      }

      // Log success
      const output = typeof result === 'string' ? result : JSON.stringify(result).substring(0, 500);
      await logger.logToolEnd(activityId, 'success', result, output, undefined, durationMs);

      return result;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Log failure
      await logger.logToolEnd(activityId, 'failure', null, undefined, errorMessage, durationMs);

      // Re-throw the error
      throw error;
    }
  };
}

/**
 * Middleware factory for wrapping OpenClaw's tool executor
 * Use this to instrument the main tool execution in OpenClaw
 */
export class OpenClawInstrumentationMiddleware {
  constructor(private logger: ActivityLogger) {}

  /**
   * Wrap the OpenClaw tool executor
   * Call this with the original tool function and it returns an instrumented version
   */
  wrapToolExecutor(
    originalExecutor: (toolName: string, params: Record<string, any>) => Promise<any>
  ) {
    return async (toolName: string, params: Record<string, any>): Promise<any> => {
      // Extract context from params or globals
      const actor = (globalThis as any).currentActor || {
        type: 'system',
        id: 'openclaw-executor',
      };
      const sessionId = (globalThis as any).currentSessionId || 'unknown-session';

      const context: ToolExecutionContext = {
        toolName,
        params,
        actor,
        sessionId,
      };

      const hook = createToolExecutionHook(this.logger);
      return hook(context, () => originalExecutor(toolName, params));
    };
  }

  /**
   * Wrap an agent delegation
   * Logs when the orchestrator delegates work to a subagent
   */
  async logDelegation(
    sessionId: string,
    parentActivityId: string | undefined,
    fromActor: { type: string; id: string },
    toAgent: { id: string; role?: string }
  ): Promise<string> {
    return this.logger.logDelegation(
      sessionId,
      parentActivityId,
      fromActor,
      toAgent.id,
      `Delegated to agent ${toAgent.id}`
    );
  }

  /**
   * Wrap an agent spawn
   * Logs when a new subagent is created
   */
  async logAgentSpawn(
    sessionId: string,
    parentActivityId: string | undefined,
    agentId: string,
    role?: string
  ): Promise<string> {
    return this.logger.logAgentSpawn(sessionId, parentActivityId, agentId, role || '');
  }

  /**
   * Set the current execution context globally
   * Call this before each tool execution to set context for the logger
   */
  setExecutionContext(sessionId: string, actor: any) {
    (globalThis as any).currentSessionId = sessionId;
    (globalThis as any).currentActor = actor;
  }

  /**
   * Clear execution context
   */
  clearExecutionContext() {
    (globalThis as any).currentSessionId = undefined;
    (globalThis as any).currentActor = undefined;
  }
}

/**
 * Simple hook that can be registered with OpenClaw's event system
 * Listens for tool execution events and logs them
 */
export class EventBasedActivityLogger {
  constructor(private logger: ActivityLogger) {}

  /**
   * Handle tool execution start event
   */
  async onToolStart(
    toolName: string,
    params: Record<string, any>,
    sessionId: string,
    actor: any
  ): Promise<string> {
    return this.logger.logToolStart(sessionId, actor, toolName, params, `Calling ${toolName}`);
  }

  /**
   * Handle tool execution end event
   */
  async onToolEnd(
    activityId: string,
    result: any,
    error: Error | null,
    durationMs: number,
    metadata?: Record<string, any>
  ) {
    if (error) {
      await this.logger.logToolEnd(activityId, 'failure', result, undefined, error.message, durationMs);
    } else {
      const output = typeof result === 'string' ? result : JSON.stringify(result).substring(0, 500);
      await this.logger.logToolEnd(activityId, 'success', result, output, undefined, durationMs);
    }

    // Handle tokens if provided in metadata
    if (metadata?.tokens) {
      await this.logger.logToolWithTokens(activityId, metadata.tokens);
    }
  }

  /**
   * Handle agent delegation event
   */
  async onDelegation(sessionId: string, parentActivityId: string | undefined, fromActor: any, toAgent: any): Promise<string> {
    return this.logger.logDelegation(
      sessionId,
      parentActivityId,
      fromActor,
      toAgent.id || toAgent,
      `Delegated to ${toAgent.id || toAgent}`
    );
  }

  /**
   * Handle agent spawn event
   */
  async onAgentSpawn(sessionId: string, parentActivityId: string | undefined, agentId: string, role?: string): Promise<string> {
    return this.logger.logAgentSpawn(sessionId, parentActivityId, agentId, role || '');
  }
}

/**
 * Configuration for OpenClaw integration
 */
export interface OpenClawIntegrationConfig {
  // Database path for activity logging
  databasePath: string;
  // Enable real-time streaming to dashboard
  enableStreaming: boolean;
  // Log token counts from API responses
  captureTokens: boolean;
  // Log full tool output (can be verbose)
  captureOutput: boolean;
  // Maximum output size in characters
  maxOutputSize: number;
}

/**
 * Initialize OpenClaw integration
 * Call this on OpenClaw startup to enable activity logging
 */
export async function initializeOpenClawIntegration(config: OpenClawIntegrationConfig) {
  const { Database } = await import('../db/database.js');
  const db = new Database(config.databasePath);
  await db.initialize();

  const logger = new ActivityLogger(db);
  const middleware = new OpenClawInstrumentationMiddleware(logger);

  return {
    logger,
    middleware,
    db,
  };
}
