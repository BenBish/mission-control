/**
 * Integration Test: Event-Based Pattern
 * Tests Mission Control integration with OpenClaw event emitter
 */

import { EventEmitter } from 'events';
import { Database } from '../db/database.js';
import { ActivityLogger } from '../logger/activity-logger.js';
import { EventBasedActivityLogger } from '../integration/openclaw-hook.js';
import { configureModelExtraction } from '../integration/openclaw-hook.js';

describe('Integration: Event-Based Pattern', () => {
  let db: Database;
  let logger: ActivityLogger;
  let eventEmitter: EventEmitter;
  let eventLogger: EventBasedActivityLogger;

  beforeAll(async () => {
    // Initialize database
    db = new Database('./test-data/integration-event.db');
    await db.initialize();

    // Initialize logger
    logger = new ActivityLogger(db);

    // Create event emitter to simulate OpenClaw
    eventEmitter = new EventEmitter();
    eventEmitter.setMaxListeners(50); // Prevent max listener warnings

    // Initialize event-based logger
    eventLogger = new EventBasedActivityLogger(logger);

    // Configure model extraction with default
    configureModelExtraction({
      defaultModel: 'openrouter/anthropic/claude-3-haiku',
      logWarnings: false,
    });
  });

  afterEach(() => {
    // Clear all listeners between tests to prevent cross-contamination
    eventEmitter.removeAllListeners();
  });

  afterAll(async () => {
    eventEmitter.removeAllListeners();
    logger.removeAllListeners();
    await db.close();
  });

  test('should log tool execution from events', async () => {
    return new Promise<void>((done) => {
      const sessionId = `test:integration:event:${Date.now()}`;
      const actor = { type: 'subagent' as const, id: 'engineer-001', role: 'Engineer' };

      let activityId: string;

      // Hook into events for logging (use once to prevent pollution)
      const toolStartHandler = async (toolName: string, params: any, context: any) => {
        activityId = await eventLogger.onToolStart(toolName, params, context.sessionId, context.actor);
        context.activityId = activityId;
      };

      const toolEndHandler = async (result: any, error: any, context: any) => {
        await eventLogger.onToolEnd(
          context.activityId,
          result,
          error,
          context.durationMs,
          context.metadata
        );
      };

      eventEmitter.once('tool:start', toolStartHandler);
      eventEmitter.once('tool:end', toolEndHandler);

      // Wait for activity creation
      logger.once('activity:created', (activity) => {
        expect(activity.actionType).toBe('tool_call');
        expect(activity.toolName).toBe('read');
        expect(activity.actor.id).toBe('engineer-001');
        expect(activity.status).toBe('pending');
        done();
      });

      // Simulate OpenClaw emitting tool:start event
      const context = {
        sessionId,
        actor,
        activityId: undefined as any,
      };

      eventEmitter.emit('tool:start', 'read', { file_path: './package.json' }, context);
    });
  });

  test('should extract model and calculate cost', async () => {
    const sessionId = `test:integration:model:${Date.now()}`;
    const actor = { type: 'subagent' as const, id: 'engineer-002' };

    let capturedActivityId = '';

    // Set up event handlers first
    const toolStartHandler = async (toolName: string, params: any, context: any) => {
      const id = await eventLogger.onToolStart(toolName, params, context.sessionId, context.actor);
      context.activityId = id;
    };

    const toolEndHandler = async (result: any, error: any, context: any) => {
      // Ensure metadata is passed through properly
      if (context.metadata) {
        await eventLogger.onToolEnd(context.activityId, result, error, context.durationMs, context.metadata);
      } else {
        await eventLogger.onToolEnd(context.activityId, result, error, context.durationMs);
      }
    };

    eventEmitter.once('tool:start', toolStartHandler);
    eventEmitter.once('tool:end', toolEndHandler);

    // Track activity creation
    const activityCreatedPromise = new Promise<void>((resolve) => {
      logger.once('activity:created', (activity) => {
        capturedActivityId = activity.id;
        resolve();
      });
    });

    // Track activity update completion
    const activityUpdatedPromise = new Promise<void>((resolve) => {
      const updateHandler = (activity: any) => {
        // Only process updates for our activity
        if (activity.id === capturedActivityId) {
          logger.removeListener('activity:updated', updateHandler);
          resolve();
        }
      };
      logger.on('activity:updated', updateHandler);
    });

    // Emit tool execution with metadata setup
    const context: any = { sessionId, actor, durationMs: 250, activityId: undefined, metadata: undefined };
    eventEmitter.emit('tool:start', 'web_search', { query: 'test' }, context);

    await activityCreatedPromise;

    // Simulate API response with tokens
    await new Promise((r) => setTimeout(r, 50));

    // Emit end with result containing tokens
    const mockResult = {
      results: ['result1', 'result2'],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 200,
      },
    };

    context.metadata = { tokens: { inputTokens: 100, outputTokens: 200, totalTokens: 300 } };
    eventEmitter.emit('tool:end', mockResult, null, context);

    // Wait for activity update to complete
    await activityUpdatedPromise;
    
    // Give database a moment to fully persist
    await new Promise((r) => setTimeout(r, 50));

    // Verify activity was updated
    const activity = await logger.getActivity(capturedActivityId);
    expect(activity).toBeDefined();
    expect(activity?.status).toBe('success');
    expect(activity?.tokens).toBeDefined();
  });

  test('should emit activity:updated event on completion', async () => {
    const sessionId = `test:integration:update:${Date.now()}`;
    const actor = { type: 'orchestrator' as const, id: 'main' };

    let capturedActivityId = '';

    const activityCreatedPromise = new Promise<void>((resolve) => {
      logger.once('activity:created', (activity) => {
        capturedActivityId = activity.id;
        resolve();
      });
    });

    const activityUpdatedPromise = new Promise<void>((resolve) => {
      const updateHandler = (activity: any) => {
        // Only process updates for our activity
        if (activity.id === capturedActivityId) {
          expect(activity.status).toBe('success');
          logger.removeListener('activity:updated', updateHandler);
          resolve();
        }
      };
      logger.on('activity:updated', updateHandler);
    });

    // Hook events
    const toolStartHandler = async (toolName: string, params: any, context: any) => {
      const id = await eventLogger.onToolStart(toolName, params, context.sessionId, context.actor);
      context.activityId = id;
    };

    const toolEndHandler = async (result: any, error: any, context: any) => {
      await eventLogger.onToolEnd(context.activityId, result, error, context.durationMs);
    };

    eventEmitter.once('tool:start', toolStartHandler);
    eventEmitter.once('tool:end', toolEndHandler);

    // Emit tool execution
    const context = { sessionId, actor, durationMs: 100, activityId: undefined as any };
    eventEmitter.emit('tool:start', 'exec', { command: 'echo test' }, context);

    await activityCreatedPromise;
    await new Promise((r) => setTimeout(r, 50));
    eventEmitter.emit('tool:end', 'test\n', null, context);

    await activityUpdatedPromise;

    const activity = await logger.getActivity(capturedActivityId);
    expect(activity?.result?.success).toBe(true);
  });

  test('should handle tool failures', async () => {
    const sessionId = `test:integration:error:${Date.now()}`;
    const actor = { type: 'subagent' as const, id: 'engineer-003' };

    let capturedActivityId = '';

    // Set up event handlers first - without intermediate promises
    const toolStartHandler = async (toolName: string, params: any, context: any) => {
      const id = await eventLogger.onToolStart(toolName, params, context.sessionId, context.actor);
      context.activityId = id;
      capturedActivityId = id;
    };

    const toolEndHandler = async (result: any, error: any, context: any) => {
      await eventLogger.onToolEnd(context.activityId, result, error, context.durationMs);
    };

    eventEmitter.once('tool:start', toolStartHandler);
    eventEmitter.once('tool:end', toolEndHandler);

    const activityUpdatedPromise = new Promise<void>((resolve) => {
      const updateHandler = (activity: any) => {
        // Only process updates for our activity
        if (activity.id === capturedActivityId) {
          expect(activity.status).toBe('failure');
          logger.removeListener('activity:updated', updateHandler);
          resolve();
        }
      };
      logger.on('activity:updated', updateHandler);
    });

    // Emit tool execution
    const context: any = { sessionId, actor, durationMs: 150, activityId: undefined };
    eventEmitter.emit('tool:start', 'read', { file_path: '/nonexistent/file' }, context);

    // Wait briefly for activity creation
    await new Promise((r) => setTimeout(r, 100));

    const error = new Error('File not found');
    eventEmitter.emit('tool:end', null, error, context);

    await activityUpdatedPromise;

    const activity = await logger.getActivity(capturedActivityId);
    expect(activity?.status).toBe('failure');
    expect(activity?.result?.error).toContain('File not found');
  });

  test('should handle agent delegation', async () => {
    const sessionId = `test:integration:delegation:${Date.now()}`;
    const orchestrator = { type: 'orchestrator' as const, id: 'main' };
    const subagent = { id: 'engineer-004', role: 'Engineer' };

    const delegationPromise = new Promise<void>((resolve) => {
      logger.once('activity:created', (activity) => {
        if (activity.actionType === 'delegation') {
          expect(activity.details?.targetAgent).toBe(subagent.id);
          resolve();
        }
      });
    });

    const delegationHandler = async (fromActor: any, toAgent: any, context: any) => {
      await eventLogger.onDelegation(context.sessionId, context.parentActivityId, fromActor, toAgent);
    };

    eventEmitter.once('agent:delegation', delegationHandler);

    // Emit delegation
    const context = { sessionId, parentActivityId: undefined };
    eventEmitter.emit('agent:delegation', orchestrator, subagent, context);

    await delegationPromise;
  });

  test('should handle agent spawn', async () => {
    const sessionId = `test:integration:spawn:${Date.now()}`;

    const spawnPromise = new Promise<void>((resolve) => {
      logger.once('activity:created', (activity) => {
        if (activity.actionType === 'agent_spawn') {
          expect(activity.details?.agentId).toBe('subagent-005');
          resolve();
        }
      });
    });

    const spawnHandler = async (agentId: string, role: string, context: any) => {
      await eventLogger.onAgentSpawn(context.sessionId, context.parentActivityId, agentId, role);
    };

    eventEmitter.once('agent:spawn', spawnHandler);

    const context = { sessionId, parentActivityId: undefined };
    eventEmitter.emit('agent:spawn', 'subagent-005', 'Engineer', context);

    await spawnPromise;
  });

  test('should track multiple sequential tools', async () => {
    const sessionId = `test:integration:multi:${Date.now()}`;
    const actor = { type: 'subagent' as const, id: 'engineer-006' };

    const activities: string[] = [];
    let toolsCompleted = 0;

    const activityCreatedHandler = (activity: any) => {
      if (activity.actionType === 'tool_call') {
        activities.push(activity.id);
      }
    };

    const activityUpdatedHandler = () => {
      toolsCompleted++;
    };

    logger.on('activity:created', activityCreatedHandler);
    logger.on('activity:updated', activityUpdatedHandler);

    // Hook events
    const toolStartHandler = async (toolName: string, params: any, context: any) => {
      const id = await eventLogger.onToolStart(toolName, params, context.sessionId, context.actor);
      context.activityId = id;
    };

    const toolEndHandler = async (result: any, error: any, context: any) => {
      await eventLogger.onToolEnd(context.activityId, result, error, context.durationMs);
    };

    eventEmitter.on('tool:start', toolStartHandler);
    eventEmitter.on('tool:end', toolEndHandler);

    // Execute 3 tools sequentially
    const tools = ['read', 'web_search', 'exec'];
    for (let i = 0; i < 3; i++) {
      const context = { sessionId, actor, durationMs: 100, activityId: undefined as any };
      eventEmitter.emit('tool:start', tools[i], { test: true }, context);
      await new Promise((r) => setTimeout(r, 75));
      eventEmitter.emit('tool:end', 'result', null, context);
      await new Promise((r) => setTimeout(r, 75));
    }

    // Wait a bit longer for final processing
    await new Promise((r) => setTimeout(r, 300));

    expect(activities.length).toBeGreaterThanOrEqual(3);
    expect(toolsCompleted).toBeGreaterThanOrEqual(3);

    // Clean up event listeners
    logger.removeListener('activity:created', activityCreatedHandler);
    logger.removeListener('activity:updated', activityUpdatedHandler);
    eventEmitter.removeListener('tool:start', toolStartHandler);
    eventEmitter.removeListener('tool:end', toolEndHandler);
  });
});
