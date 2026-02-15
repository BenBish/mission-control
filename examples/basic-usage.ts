/**
 * Basic Usage Example
 * Demonstrates how to use the Activity Logger
 */

import { Database } from '../src/db/database.js';
import { ActivityLogger } from '../src/logger/activity-logger.js';

async function example() {
  // Initialize database
  const db = new Database('./data/example.db');
  await db.initialize();

  // Create activity logger
  const logger = new ActivityLogger(db);

  // Log session start
  const sessionId = 'agent:main:session:001';
  await logger.logSessionStart(sessionId);

  // Log a user request
  await logger.logUserRequest(sessionId, 'ben', 'Run git status');

  // Log tool execution start
  const toolActivityId = await logger.logToolStart(
    sessionId,
    {
      type: 'subagent',
      id: 'agent:main:subagent:abc123',
      role: 'Engineer',
    },
    'exec',
    { command: 'git status', workdir: '/home/ben/project' },
    'Executed shell command: git status'
  );

  // Simulate tool execution
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Log tool completion with tokens
  await logger.logToolEnd(
    toolActivityId,
    'success',
    { exitCode: 0 },
    'On branch main\nYour branch is up to date',
    undefined,
    150
  );

  await logger.logToolWithTokens(toolActivityId, {
    inputTokens: 124,
    outputTokens: 80,
    totalTokens: 204,
    model: 'openrouter/anthropic/claude-haiku-4.5',
  });

  // Log session end
  await logger.logSessionEnd(sessionId);

  // Get session summary
  const summary = await logger.getSessionSummary(sessionId);
  console.log('\n📊 Session Summary:');
  console.log(JSON.stringify(summary, null, 2));

  // Clean up
  await db.close();
}

example().catch(console.error);
