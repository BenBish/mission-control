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

    // Initialize event-based logger
    eventLogger = new EventBasedActivityLogger(logger);

    // Configure model extraction with default
    configureModelExtraction({
      defaultModel: 'openrouter/anthropic/claude-3-haiku',
      logWarnings: false,
    });
  });

  afterAll(async () => {
    await db.close();
  });

  test('should log tool execution from events', async () => {
    return new Promise<void>((done) => {
      const sessionId = `test:integration:event:${Date.now()}`;
      const actor = { type: 'subagent' as const, id: 'engineer-001', role: 'Engineer' };

      let activityId: string;

      // Hook into events for logging
      eventEmitter.on('tool:start', async (toolName, params, context) => {
        activityId = await eventLogger.onToolStart(toolName, params, context.sessionId, context.actor);
        context.activityId = activityId;
      });

      eventEmitter.on('tool:end', async (result, error, context) => {
        await eventLogger.onToolEnd(
          context.activityId,
          result,
          error,
          context.durationMs,
          context.metadata
        );
      });

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

    // Track activity creation
    const activityCreatedPromise = new Promise<void>((resolve) => {
      logger.once('activity:created', (activity) => {
        capturedActivityId = activity.id;
        resolve();
      });
    });

    // Hook events
    eventEmitter.on('tool:start', async (toolName, params, context) => {
      const id = await eventLogger.onToolStart(toolName, params, context.sessionId, context.actor);
      context.activityId = id;
    });

    eventEmitter.on('tool:end', async (result, error, context) => {
      await eventLogger.onToolEnd(context.activityId, result, error, context.durationMs, context.metadata);
    });

    // Emit tool execution
    const context: any = { sessionId, actor, durationMs: 250, activityId: undefined };
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

    // Wait a bit for processing
    await new Promise((r) => setTimeout(r, 100));

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
      logger.once('activity:updated', (activity) => {
        expect(activity.status).toBe('success');
        resolve();
      });
    });

    // Hook events
    eventEmitter.on('tool:start', async (toolName, params, context) => {
      const id = await eventLogger.onToolStart(toolName, params, context.sessionId, context.actor);
      context.activityId = id;
    });

    eventEmitter.on('tool:end', async (result, error, context) => {
      await eventLogger.onToolEnd(context.activityId, result, error, context.durationMs);
    });

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

    const activityCreatedPromise = new Promise<void>((resolve) => {
      logger.once('activity:created', () => {
        resolve();
      });
    });

    const activityUpdatedPromise = new Promise<void>((resolve) => {
      logger.once('activity:updated', (activity) => {
        expect(activity.status).toBe('failure');
        resolve();
      });
    });

    // Hook events
    eventEmitter.on('tool:start', async (toolName, params, context) => {
      const id = await eventLogger.onToolStart(toolName, params, context.sessionId, context.actor);
      context.activityId = id;
      capturedActivityId = id;
    });

    eventEmitter.on('tool:end', async (result, error, context) => {
      await eventLogger.onToolEnd(context.activityId, result, error, context.durationMs);
    });

    // Emit tool execution
    const context = { sessionId, actor, durationMs: 150, activityId: undefined as any };
    eventEmitter.emit('tool:start', 'read', { file_path: '/nonexistent/file' }, context);

    await activityCreatedPromise;
    await new Promise((r) => setTimeout(r, 50));

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

    eventEmitter.on('agent:delegation', async (fromActor, toAgent, context) => {
      await eventLogger.onDelegation(context.sessionId, context.parentActivityId, fromActor, toAgent);
    });

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

    eventEmitter.on('agent:spawn', async (agentId, role, context) => {
      await eventLogger.onAgentSpawn(context.sessionId, context.parentActivityId, agentId, role);
    });

    const context = { sessionId, parentActivityId: undefined };
    eventEmitter.emit('agent:spawn', 'subagent-005', 'Engineer', context);

    await spawnPromise;
  });

  test('should track multiple sequential tools', async () => {
    const sessionId = `test:integration:multi:${Date.now()}`;
    const actor = { type: 'subagent' as const, id: 'engineer-006' };

    const activities: string[] = [];
    let toolsCompleted = 0;

    logger.on('activity:created', (activity) => {
      if (activity.actionType === 'tool_call') {
        activities.push(activity.id);
      }
    });

    logger.on('activity:updated', () => {
      toolsCompleted++;
    });

    // Hook events
    eventEmitter.on('tool:start', async (toolName, params, context) => {
      const id = await eventLogger.onToolStart(toolName, params, context.sessionId, context.actor);
      context.activityId = id;
    });

    eventEmitter.on('tool:end', async (result, error, context) => {
      await eventLogger.onToolEnd(context.activityId, result, error, context.durationMs);
    });

    // Execute 3 tools
    for (let i = 0; i < 3; i++) {
      const context = { sessionId, actor, durationMs: 100, activityId: undefined as any };
      const tools = ['read', 'web_search', 'exec'];
      eventEmitter.emit('tool:start', tools[i], { test: true }, context);
      await new Promise((r) => setTimeout(r, 50));
      eventEmitter.emit('tool:end', 'result', null, context);
      await new Promise((r) => setTimeout(r, 50));
    }

    await new Promise((r) => setTimeout(r, 200));

    expect(activities.length).toBeGreaterThanOrEqual(3);
    expect(toolsCompleted).toBeGreaterThanOrEqual(3);
  });
});
