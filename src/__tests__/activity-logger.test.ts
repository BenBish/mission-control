/**
 * Activity Logger Tests
 * Verifies logging functionality and data integrity
 */

import { Database } from '../db/database.js';
import { ActivityLogger } from '../logger/activity-logger.js';
import fs from 'fs';
import path from 'path';

const TEST_DB_PATH = './test-data/test.db';

describe('ActivityLogger', () => {
  let db: Database;
  let logger: ActivityLogger;

  beforeAll(async () => {
    // Create test database directory
    if (!fs.existsSync('./test-data')) {
      fs.mkdirSync('./test-data', { recursive: true });
    }

    db = new Database(TEST_DB_PATH);
    await db.initialize();
    logger = new ActivityLogger(db);
  });

  afterAll(async () => {
    await db.close();
    // Cleanup
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

  beforeEach(async () => {
    await db.clear();
  });

  describe('Session Management', () => {
    test('should log session start', async () => {
      const sessionId = 'test:session:001';

      const activityId = await logger.logSessionStart(sessionId);

      expect(activityId).toBeTruthy();

      const activity = await logger.getActivity(activityId);
      expect(activity).toBeTruthy();
      expect(activity?.sessionId).toBe(sessionId);
      expect(activity?.actionType).toBe('session_start');
      expect(activity?.status).toBe('success');
    });

    test('should log session end', async () => {
      const sessionId = 'test:session:002';

      await logger.logSessionStart(sessionId);
      const endId = await logger.logSessionEnd(sessionId);

      const activity = await logger.getActivity(endId);
      expect(activity?.actionType).toBe('session_end');
    });

    test('should create session in database', async () => {
      const sessionId = 'test:session:003';

      await logger.logSessionStart(sessionId);
      const summary = await logger.getSessionSummary(sessionId);

      expect(summary).toBeTruthy();
      expect(summary?.sessionId).toBe(sessionId);
      expect(summary?.stats.totalActions).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Tool Execution Logging', () => {
    test('should log tool start', async () => {
      const sessionId = 'test:session:004';
      await logger.logSessionStart(sessionId);

      const activityId = await logger.logToolStart(
        sessionId,
        { type: 'subagent', id: 'agent:001', role: 'Engineer' },
        'exec',
        { command: 'git status' },
        'Executed: git status'
      );

      expect(activityId).toBeTruthy();

      const activity = await logger.getActivity(activityId);
      expect(activity?.toolName).toBe('exec');
      expect(activity?.actionType).toBe('tool_call');
      expect(activity?.status).toBe('pending');
      expect(activity?.details?.command).toBe('git status');
    });

    test('should log tool completion', async () => {
      const sessionId = 'test:session:005';
      await logger.logSessionStart(sessionId);

      const activityId = await logger.logToolStart(
        sessionId,
        { type: 'subagent', id: 'agent:001' },
        'exec',
        { command: 'echo hello' },
        'Test execution'
      );

      await logger.logToolEnd(
        activityId,
        'success',
        { exitCode: 0 },
        'hello',
        undefined,
        100
      );

      const activity = await logger.getActivity(activityId);
      expect(activity?.status).toBe('success');
      expect(activity?.durationMs).toBe(100);
      expect(activity?.result?.output).toBe('hello');
      expect(activity?.result?.success).toBe(true);
    });

    test('should log tool failure', async () => {
      const sessionId = 'test:session:006';
      await logger.logSessionStart(sessionId);

      const activityId = await logger.logToolStart(
        sessionId,
        { type: 'subagent', id: 'agent:001' },
        'exec',
        { command: 'false' },
        'Failed execution'
      );

      await logger.logToolEnd(
        activityId,
        'failure',
        { success: false },
        undefined,
        'Command failed',
        50
      );

      const activity = await logger.getActivity(activityId);
      expect(activity?.status).toBe('failure');
      expect(activity?.result?.error).toBe('Command failed');
      expect(activity?.result?.success).toBe(false);
    });
  });

  describe('Token Tracking', () => {
    test('should log tokens and calculate cost', async () => {
      const sessionId = 'test:session:007';
      await logger.logSessionStart(sessionId);

      const activityId = await logger.logToolStart(
        sessionId,
        { type: 'subagent', id: 'agent:001' },
        'web_search',
        { query: 'test' },
        'Search'
      );

      await logger.logToolWithTokens(activityId, {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        model: 'openrouter/anthropic/claude-haiku-4.5'
      });

      const activity = await logger.getActivity(activityId);
      expect(activity?.tokens?.totalTokens).toBe(150);
      expect(activity?.cost?.usd).toBeGreaterThan(0);
      expect(activity?.cost?.usd).toBeLessThan(0.10); // Should be cheap (haiku pricing)
    });

    test('should calculate cost correctly for different models', async () => {
      const sessionId = 'test:session:008';
      await logger.logSessionStart(sessionId);

      // Test Haiku (cheaper)
      const haiku = await logger.logToolStart(
        sessionId,
        { type: 'subagent', id: 'agent:001' },
        'web_search',
        {},
        'Haiku'
      );

      await logger.logToolWithTokens(haiku, {
        inputTokens: 1000,
        outputTokens: 1000,
        totalTokens: 2000,
        model: 'openrouter/anthropic/claude-haiku-4.5'
      });

      // Test Opus (more expensive)
      const opus = await logger.logToolStart(
        sessionId,
        { type: 'subagent', id: 'agent:002' },
        'web_search',
        {},
        'Opus'
      );

      await logger.logToolWithTokens(opus, {
        inputTokens: 1000,
        outputTokens: 1000,
        totalTokens: 2000,
        model: 'openrouter/anthropic/claude-3-opus'
      });

      const haiku_activity = await logger.getActivity(haiku);
      const opus_activity = await logger.getActivity(opus);

      expect(opus_activity?.cost?.usd).toBeGreaterThan(haiku_activity?.cost?.usd || 0);
    });
  });

  describe('Delegation & Agent Events', () => {
    test('should log delegation', async () => {
      const sessionId = 'test:session:009';
      await logger.logSessionStart(sessionId);

      const delegationId = await logger.logDelegation(
        sessionId,
        undefined,
        { type: 'orchestrator', id: 'agent:main' },
        'Engineer',
        'Delegated to Engineer'
      );

      const activity = await logger.getActivity(delegationId);
      expect(activity?.actionType).toBe('delegation');
      expect(activity?.details?.targetAgent).toBe('Engineer');
    });

    test('should log agent spawn', async () => {
      const sessionId = 'test:session:010';
      await logger.logSessionStart(sessionId);

      const spawnId = await logger.logAgentSpawn(
        sessionId,
        undefined,
        'agent:subagent:001',
        'Engineer'
      );

      const activity = await logger.getActivity(spawnId);
      expect(activity?.actionType).toBe('agent_spawn');
      expect(activity?.details?.agentId).toBe('agent:subagent:001');
      expect(activity?.details?.agentRole).toBe('Engineer');
    });
  });

  describe('User Input', () => {
    test('should log user request', async () => {
      const sessionId = 'test:session:011';
      await logger.logSessionStart(sessionId);

      const requestId = await logger.logUserRequest(
        sessionId,
        'ben',
        'Run git status'
      );

      const activity = await logger.getActivity(requestId);
      expect(activity?.actionType).toBe('user_request');
      expect(activity?.actor.type).toBe('user');
      expect(activity?.actor.id).toBe('ben');
    });
  });

  describe('Session Summary', () => {
    test('should compute session summary correctly', async () => {
      const sessionId = 'test:session:012';
      await logger.logSessionStart(sessionId);

      // Log multiple activities
      const id1 = await logger.logToolStart(
        sessionId,
        { type: 'subagent', id: 'agent:001' },
        'exec',
        {},
        'Tool 1'
      );

      const id2 = await logger.logToolStart(
        sessionId,
        { type: 'subagent', id: 'agent:002' },
        'read',
        {},
        'Tool 2'
      );

      await logger.logToolEnd(id1, 'success', {}, '', undefined, 100);
      await logger.logToolEnd(id2, 'failure', {}, '', 'Error', 50);

      const summary = await logger.getSessionSummary(sessionId);

      expect(summary).toBeTruthy();
      expect(summary?.stats.totalActions).toBeGreaterThanOrEqual(3); // Start + 2 tools
      expect(summary?.stats.successCount).toBeGreaterThanOrEqual(1);
      expect(summary?.stats.failureCount).toBeGreaterThanOrEqual(1);
    });

    test('should track actors in summary', async () => {
      const sessionId = 'test:session:013';
      await logger.logSessionStart(sessionId);

      const id1 = await logger.logToolStart(
        sessionId,
        { type: 'subagent', id: 'agent:001' },
        'exec',
        {},
        'Tool by agent 1'
      );

      const id2 = await logger.logToolStart(
        sessionId,
        { type: 'subagent', id: 'agent:002' },
        'exec',
        {},
        'Tool by agent 2'
      );

      await logger.logToolEnd(id1, 'success', {}, '', undefined, 100);
      await logger.logToolEnd(id2, 'success', {}, '', undefined, 100);

      const summary = await logger.getSessionSummary(sessionId);

      expect(summary?.actors['agent:001']).toBeTruthy();
      expect(summary?.actors['agent:002']).toBeTruthy();
      expect(summary?.actors['agent:001'].actionsCount).toBeGreaterThanOrEqual(1);
    });

    test('should track top tools in summary', async () => {
      const sessionId = 'test:session:014';
      await logger.logSessionStart(sessionId);

      // Log same tool multiple times
      for (let i = 0; i < 3; i++) {
        const id = await logger.logToolStart(
          sessionId,
          { type: 'subagent', id: 'agent:001' },
          'exec',
          {},
          `Tool execution ${i}`
        );
        await logger.logToolEnd(id, 'success', {}, '', undefined, 50);
      }

      const summary = await logger.getSessionSummary(sessionId);

      expect(summary?.topTools.length).toBeGreaterThan(0);
      const execTool = summary?.topTools.find((t) => t.name === 'exec');
      expect(execTool?.count).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Pending Activities', () => {
    test('should track pending activities', async () => {
      const sessionId = 'test:session:015';
      await logger.logSessionStart(sessionId);

      const id = await logger.logToolStart(
        sessionId,
        { type: 'subagent', id: 'agent:001' },
        'exec',
        {},
        'Pending'
      );

      const pending = logger.getPendingActivities();
      expect(pending.length).toBeGreaterThan(0);
      expect(pending.some((a) => a.id === id)).toBe(true);

      await logger.logToolEnd(id, 'success', {}, '', undefined, 100);

      const pending2 = logger.getPendingActivities();
      expect(pending2.some((a) => a.id === id)).toBe(false);
    });
  });

  describe('Event Emission', () => {
    test('should emit activity:created event', (done) => {
      const sessionId = 'test:session:016';

      // Use on with a filter since session_start will also emit activity:created
      const handler = (activity: any) => {
        if (activity.actionType === 'tool_call') {
          logger.removeListener('activity:created', handler);
          expect(activity.actionType).toBe('tool_call');
          done();
        }
      };

      logger.on('activity:created', handler);

      logger.logSessionStart(sessionId).then(() => {
        logger.logToolStart(
          sessionId,
          { type: 'subagent', id: 'agent:001' },
          'exec',
          {},
          'Event test'
        );
      });
    });

    test('should emit activity:complete event', (done) => {
      const sessionId = 'test:session:017';

      logger.once('activity:complete', (data) => {
        expect(data.status).toBe('success');
        done();
      });

      logger.logSessionStart(sessionId).then(async () => {
        const id = await logger.logToolStart(
          sessionId,
          { type: 'subagent', id: 'agent:001' },
          'exec',
          {},
          'Complete test'
        );
        await logger.logToolEnd(id, 'success', {}, '', undefined, 100);
      });
    });
  });
});
