/**
 * Simple test workflow runner
 * Tests Mission Control integration end-to-end
 */

import { Database } from './dist/db/database.js';
import { ActivityLogger } from './dist/logger/activity-logger.js';

async function runTestWorkflow() {
  console.log('🚀 Starting Mission Control test workflow...\n');

  // Initialize
  const db = new Database('./data/mission-control-test.db');
  await db.initialize();

  const logger = new ActivityLogger(db);

  console.log('✓ Integration initialized');
  console.log('📦 Using database: ./data/mission-control-test.db\n');

  const sessionId = `test-session-${Date.now()}`;
  const orchestratorId = 'agent:main:main';
  const subagentId = 'agent:main:subagent:engineer-001';

  // Session start
  console.log('📝 [1/6] Logging session start...');
  await logger.logSessionStart(sessionId);
  await sleep(100);

  // User request
  console.log('📝 [2/6] Logging user request...');
  await logger.logUserRequest(sessionId, 'ben', 'Build React dashboard');
  await sleep(100);

  // Tool call 1
  console.log('📝 [3/6] Logging tool calls...');
  const readActivityId = await logger.logToolStart(
    sessionId,
    { type: 'subagent', id: subagentId, role: 'Engineer' },
    'read',
    { file_path: './package.json' },
    'Reading package.json'
  );

  await sleep(300);

  await logger.logToolEnd(readActivityId, 'success', null, '{"name": "mission-control", ...}', undefined, 300);

  await logger.logToolWithTokens(readActivityId, {
    inputTokens: 125,
    outputTokens: 450,
    totalTokens: 575,
    model: 'openrouter/anthropic/claude-haiku-4.5',
  });

  await sleep(100);

  // Tool call 2
  const searchActivityId = await logger.logToolStart(
    sessionId,
    { type: 'subagent', id: subagentId, role: 'Engineer' },
    'web_search',
    { query: 'react dashboard examples' },
    'Searching for examples'
  );

  await sleep(500);

  await logger.logToolEnd(searchActivityId, 'success', null, 'Found 5 relevant results', undefined, 500);

  await logger.logToolWithTokens(searchActivityId, {
    inputTokens: 75,
    outputTokens: 200,
    totalTokens: 275,
    model: 'openrouter/anthropic/claude-haiku-4.5',
  });

  await sleep(100);

  // Tool call 3
  const execActivityId = await logger.logToolStart(
    sessionId,
    { type: 'subagent', id: subagentId, role: 'Engineer' },
    'exec',
    { command: 'npm install react' },
    'Installing dependencies'
  );

  await sleep(1000);

  await logger.logToolEnd(
    execActivityId,
    'success',
    null,
    'added 3 packages, audited 584 packages in 12s',
    undefined,
    1000
  );

  await sleep(100);

  console.log('📝 [4/6] Logging delegation...');
  await logger.logDelegation(
    sessionId,
    undefined,
    { type: 'orchestrator', id: orchestratorId },
    subagentId,
    'Delegated to engineer'
  );
  await sleep(100);

  console.log('📝 [5/6] Logging message...');
  await logger.logMessage(
    sessionId,
    { type: 'subagent', id: subagentId, role: 'Engineer' },
    'orchestrator',
    'Task completed successfully'
  );
  await sleep(100);

  console.log('📝 [6/6] Logging session end...');
  await logger.logSessionEnd(sessionId);

  // Summary
  console.log('\n✅ Workflow complete!\n');

  const summary = await logger.getSessionSummary(sessionId);
  if (summary) {
    console.log('Session Summary:');
    console.log(`  Total Actions: ${summary.stats.totalActions}`);
    console.log(`  Success Rate: ${summary.stats.successRate.toFixed(1)}%`);
    console.log(`  Total Tokens: ${summary.stats.totalTokens}`);
    console.log(`  Total Cost: $${summary.stats.totalCost.toFixed(4)}`);
    console.log(`\n✨ Activities logged successfully!`);
  }

  console.log('\n📊 Next: Start dashboard with: npm run api');
  console.log('🌐 Then open: http://localhost:3001\n');

  await sleep(200);
  process.exit(0);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

runTestWorkflow().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});
