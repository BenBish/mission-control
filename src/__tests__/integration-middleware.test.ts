/**
 * Integration Test: Middleware Wrapper Pattern
 * Tests Mission Control integration with tool executor wrapping
 */

import { Database } from '../db/database.js';
import { ActivityLogger } from '../logger/activity-logger.js';
import { OpenClawInstrumentationMiddleware, configureModelExtraction } from '../integration/openclaw-hook.js';

describe('Integration: Middleware Wrapper Pattern', () => {
  let db: Database;
  let logger: ActivityLogger;
  let middleware: OpenClawInstrumentationMiddleware;

  beforeAll(async () => {
    // Initialize database
    db = new Database('./test-data/integration-middleware.db');
    await db.initialize();

    // Initialize logger
    logger = new ActivityLogger(db);

    // Initialize middleware
    middleware = new OpenClawInstrumentationMiddleware(logger);

    // Configure model extraction
    configureModelExtraction({
      defaultModel: 'openrouter/anthropic/claude-3-haiku',
      logWarnings: false,
    });
  });

  afterAll(async () => {
    await db.close();
  });

  // Mock tool executor function
  const createMockExecutor = () => {
    return async (toolName: string, params: Record<string, any>) => {
      // Simulate tool execution
      await new Promise((r) => setTimeout(r, 50));

      // Return result based on tool
      switch (toolName) {
        case 'read':
          return { content: '{"name": "test"}' };
        case 'web_search':
          return {
            results: [{ title: 'Result 1', url: 'http://example.com' }],
            usage: { prompt_tokens: 100, completion_tokens: 50 },
          };
        case 'exec':
          return 'Command output';
        default:
          return { status: 'ok' };
      }
    };
  };

  test('should wrap tool executor successfully', async () => {
    return new Promise<void>((done) => {
      const originalExecutor = createMockExecutor();
      const wrappedExecutor = middleware.wrapToolExecutor(originalExecutor);

      const sessionId = `test:middleware:wrap:${Date.now()}`;
      const actor = { type: 'subagent' as const, id: 'engineer-001', role: 'Engineer' };

      // Set execution context
      middleware.setExecutionContext(sessionId, actor, 'openrouter/anthropic/claude-3-opus');

      // Verify activity created
      logger.once('activity:created', (activity) => {
        expect(activity.actionType).toBe('tool_call');
        expect(activity.toolName).toBe('read');
        expect(activity.sessionId).toBe(sessionId);
        done();
      });

      // Execute wrapped tool
      wrappedExecutor('read', { file_path: './test.txt' }).then((result) => {
        expect(result.content).toBe('{"name": "test"}');
        // Clean up
        middleware.clearExecutionContext();
      });
    });
  });

  test('should handle sequential tool calls with proper isolation', async () => {
    const originalExecutor = createMockExecutor();
    const wrappedExecutor = middleware.wrapToolExecutor(originalExecutor);

    const sessionId = `test:middleware:sequential:${Date.now()}`;
    const actor1 = { type: 'subagent' as const, id: 'engineer-002' };
    const actor2 = { type: 'subagent' as const, id: 'engineer-003' };

    const activities: any[] = [];
    logger.on('activity:created', (activity) => {
      if (activity.actionType === 'tool_call') {
        activities.push(activity);
      }
    });

    // First tool call
    middleware.setExecutionContext(sessionId, actor1, 'model-1');
    await wrappedExecutor('read', { file: 'test1.txt' });
    middleware.clearExecutionContext();

    await new Promise((r) => setTimeout(r, 100));

    // Second tool call with different actor
    middleware.setExecutionContext(sessionId, actor2, 'model-2');
    await wrappedExecutor('web_search', { query: 'test' });
    middleware.clearExecutionContext();

    await new Promise((r) => setTimeout(r, 100));

    // Verify activities have correct actor info
    expect(activities.length).toBeGreaterThanOrEqual(2);
    expect(activities[0].actor.id).toBe('engineer-002');
    expect(activities[1].actor.id).toBe('engineer-003');
  });

  test('should properly handle errors without losing context', async () => {
    const errorExecutor = async () => {
      throw new Error('Tool execution failed');
    };

    const wrappedExecutor = middleware.wrapToolExecutor(errorExecutor);

    const sessionId = `test:middleware:error:${Date.now()}`;
    const actor = { type: 'subagent' as const, id: 'engineer-004' };

    middleware.setExecutionContext(sessionId, actor);

    const activityPromise = new Promise<void>((resolve) => {
      logger.once('activity:updated', (activity) => {
        if (activity.status === 'failure') {
          expect(activity.result?.error).toContain('Tool execution failed');
          resolve();
        }
      });
    });

    try {
      await wrappedExecutor('broken_tool', {});
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
    }

    await activityPromise;

    // Context should still be set
    expect((globalThis as any).currentSessionId).toBe(sessionId);

    // Manually clear
    middleware.clearExecutionContext();
    expect((globalThis as any).currentSessionId).toBeUndefined();
  });

  test('should extract model from context', async () => {
    const originalExecutor = createMockExecutor();
    const wrappedExecutor = middleware.wrapToolExecutor(originalExecutor);

    const sessionId = `test:middleware:model:${Date.now()}`;
    const actor = { type: 'subagent' as const, id: 'engineer-005' };
    const model = 'openrouter/anthropic/claude-3-sonnet';

    let capturedActivity: any = null;

    logger.once('activity:created', (activity) => {
      capturedActivity = activity;
    });

    middleware.setExecutionContext(sessionId, actor, model);
    await wrappedExecutor('exec', { command: 'echo test' });

    await new Promise((r) => setTimeout(r, 100));

    expect(capturedActivity).toBeDefined();
    expect((globalThis as any).currentModel).toBe(model);

    middleware.clearExecutionContext();
  });

  test('should measure execution duration', async () => {
    const slowExecutor = async () => {
      await new Promise((r) => setTimeout(r, 150));
      return 'slow result';
    };

    const wrappedExecutor = middleware.wrapToolExecutor(slowExecutor);

    const sessionId = `test:middleware:duration:${Date.now()}`;
    const actor = { type: 'orchestrator' as const, id: 'main' };

    let capturedActivity: any = null;

    logger.once('activity:updated', (activity) => {
      capturedActivity = activity;
    });

    middleware.setExecutionContext(sessionId, actor);
    const start = Date.now();
    await wrappedExecutor('slow_tool', {});
    const elapsed = Date.now() - start;

    await new Promise((r) => setTimeout(r, 100));

    expect(capturedActivity).toBeDefined();
    expect(capturedActivity.durationMs).toBeGreaterThanOrEqual(150);
    expect(capturedActivity.durationMs).toBeLessThan(elapsed + 100);

    middleware.clearExecutionContext();
  });

  test('should handle tool with token response', async () => {
    const tokenizedExecutor = async () => {
      return {
        result: 'success',
        usage: {
          prompt_tokens: 250,
          completion_tokens: 150,
        },
        model: 'gpt-4-turbo',
      };
    };

    const wrappedExecutor = middleware.wrapToolExecutor(tokenizedExecutor);

    const sessionId = `test:middleware:tokens:${Date.now()}`;
    const actor = { type: 'subagent' as const, id: 'engineer-006' };

    let capturedActivityId = '';

    logger.once('activity:created', (activity) => {
      capturedActivityId = activity.id;
    });

    middleware.setExecutionContext(sessionId, actor);
    await wrappedExecutor('api_call', {});

    await new Promise((r) => setTimeout(r, 100));

    const activity = await logger.getActivity(capturedActivityId);
    expect(activity).toBeDefined();
    expect(activity?.tokens).toBeDefined();
    expect(activity?.tokens?.inputTokens).toBe(250);
    expect(activity?.tokens?.outputTokens).toBe(150);

    middleware.clearExecutionContext();
  });

  test('should track multiple tools in workflow', async () => {
    const originalExecutor = createMockExecutor();
    const wrappedExecutor = middleware.wrapToolExecutor(originalExecutor);

    const sessionId = `test:middleware:workflow:${Date.now()}`;
    const orchestrator = { type: 'orchestrator' as const, id: 'main' };
    const tools = ['read', 'web_search', 'exec'];

    const activities: any[] = [];

    logger.on('activity:created', (activity) => {
      if (activity.actionType === 'tool_call') {
        activities.push(activity);
      }
    });

    middleware.setExecutionContext(sessionId, orchestrator);

    for (const tool of tools) {
      await wrappedExecutor(tool, { test: true });
      await new Promise((r) => setTimeout(r, 75));
    }

    middleware.clearExecutionContext();

    await new Promise((r) => setTimeout(r, 200));

    expect(activities.length).toBeGreaterThanOrEqual(3);
    expect(activities.map((a) => a.toolName)).toEqual(expect.arrayContaining(['read', 'web_search', 'exec']));
  });

  test('should reset context after clear', async () => {
    const sessionId = 'test:middleware:reset:1';
    const actor = { type: 'subagent' as const, id: 'test' };

    middleware.setExecutionContext(sessionId, actor, 'model-1');
    expect((globalThis as any).currentSessionId).toBe(sessionId);

    middleware.clearExecutionContext();
    expect((globalThis as any).currentSessionId).toBeUndefined();
    expect((globalThis as any).currentActor).toBeUndefined();
    expect((globalThis as any).currentModel).toBeUndefined();
  });
});
