/**
 * Test Workflow
 * Demonstrates end-to-end activity tracking with Mission Control
 * 
 * Run this workflow to verify that all activities are properly logged
 * and appear in the dashboard at http://localhost:3001
 */

import { initializeOpenClawIntegration } from '../src/integration/openclaw-hook.js';

async function runTestWorkflow() {
  console.log('🚀 Starting Mission Control test workflow...\n');

  // Initialize integration
  const { logger, db } = await initializeOpenClawIntegration({
    databasePath: './data/mission-control-test.db',
    enableStreaming: true,
    captureTokens: true,
    captureOutput: true,
    maxOutputSize: 5000,
  });

  console.log('✓ Integration initialized');
  console.log('📦 Using database: ./data/mission-control-test.db\n');

  // Session ID (simulating OpenClaw session)
  const sessionId = `test-session-${Date.now()}`;
  const orchestratorId = 'agent:main:main';
  const subagentId = 'agent:main:subagent:engineer-001';

  // Log session start
  console.log('📝 [1/9] Logging session start...');
  await logger.logSessionStart(sessionId);
  await sleep(100);

  // Log user request
  console.log('📝 [2/9] Logging user request...');
  await logger.logUserRequest(sessionId, 'ben', 'Build a React dashboard for activity tracking');
  await sleep(100);

  // Orchestrator decision - log as API call
  console.log('📝 [3/9] Logging orchestrator decision...');
  const orchestratorActivityId = await logger.logApiCall(
    sessionId,
    { type: 'orchestrator', id: orchestratorId },
    'orchestrator/decide',
    'POST',
    200
  );
  await sleep(100);

  // Subagent delegation
  console.log('📝 [4/9] Logging subagent delegation...');
  const delegationActivityId = await logger.logDelegation(
    sessionId,
    orchestratorActivityId,
    { type: 'orchestrator', id: orchestratorId },
    { id: subagentId, role: 'Engineer' }
  );
  await sleep(100);

  // Subagent spawn
  console.log('📝 [5/9] Logging subagent spawn...');
  await logger.logAgentSpawn(sessionId, delegationActivityId, subagentId, 'Engineer');
  await sleep(100);

  // Simulate tool executions
  console.log('📝 [6/9] Logging tool executions...');

  // Tool 1: read package.json
  const readActivityId = await logger.logToolStart(
    sessionId,
    {
      type: 'subagent',
      id: subagentId,
      role: 'Engineer',
    },
    'read',
    { file_path: './package.json' },
    'Reading package.json for dependencies'
  );

  await sleep(300); // Simulate execution time

  await logger.logToolEnd(
    readActivityId,
    'success',
    null,
    '{\n  "name": "mission-control-activity-feed",\n  "version": "0.2.0",\n  "description": "Activity feed and cost tracking",\n  "dependencies": { ... }\n}',
    undefined,
    300
  );

  // Log tokens for the read operation
  await logger.logToolWithTokens(readActivityId, {
    inputTokens: 125,
    outputTokens: 450,
    totalTokens: 575,
    model: 'openrouter/anthropic/claude-haiku-4.5',
  });

  await sleep(100);

  // Tool 2: web_search
  const searchActivityId = await logger.logToolStart(
    sessionId,
    {
      type: 'subagent',
      id: subagentId,
      role: 'Engineer',
    },
    'web_search',
    { query: 'react dashboard recharts examples' },
    'Searching for React dashboard examples'
  );

  await sleep(500); // Simulate execution time

  await logger.logToolEnd(
    searchActivityId,
    'success',
    null,
    'Found 5 relevant results about React dashboards with Recharts',
    undefined,
    500
  );

  // Log tokens for search
  await logger.logToolWithTokens(searchActivityId, {
    inputTokens: 75,
    outputTokens: 200,
    totalTokens: 275,
    model: 'openrouter/anthropic/claude-haiku-4.5',
  });

  await sleep(100);

  // Tool 3: exec command
  const execActivityId = await logger.logToolStart(
    sessionId,
    {
      type: 'subagent',
      id: subagentId,
      role: 'Engineer',
    },
    'exec',
    { command: 'npm install react react-dom recharts --save' },
    'Installing React dependencies'
  );

  await sleep(2000); // Simulate longer execution

  await logger.logToolEnd(
    execActivityId,
    'success',
    null,
    'added 3 packages, and audited 584 packages in 12s',
    undefined,
    2000
  );

  // No tokens for local exec

  await sleep(100);

  // Tool 4: write file
  const writeActivityId = await logger.logToolStart(
    sessionId,
    {
      type: 'subagent',
      id: subagentId,
      role: 'Engineer',
    },
    'write',
    { file_path: './src/frontend/App.tsx', content: '// React app component...' },
    'Creating React app component'
  );

  await sleep(200);

  await logger.logToolEnd(
    writeActivityId,
    'success',
    null,
    'File written successfully: 3,245 bytes',
    undefined,
    200
  );

  // Log tokens for write
  await logger.logToolWithTokens(writeActivityId, {
    inputTokens: 2000,
    outputTokens: 300,
    totalTokens: 2300,
    model: 'openrouter/anthropic/claude-opus-3-sonnet',
  });

  await sleep(100);

  // Tool 5: Failed execution (simulate error)
  const failActivityId = await logger.logToolStart(
    sessionId,
    {
      type: 'subagent',
      id: subagentId,
      role: 'Engineer',
    },
    'exec',
    { command: 'npm run build' },
    'Building React app'
  );

  await sleep(1000);

  // Simulate a build error
  await logger.logToolEnd(
    failActivityId,
    'failure',
    null,
    undefined,
    'TypeScript error: Cannot find module "recharts"',
    1000
  );

  await sleep(100);

  // Log message
  console.log('📝 [7/9] Logging inter-agent message...');
  await logger.logMessage(
    sessionId,
    { type: 'subagent', id: subagentId, role: 'Engineer' },
    'orchestrator',
    'Build failed - missing dependency. Requesting clarification.'
  );

  await sleep(100);

  // Log API call
  console.log('📝 [8/9] Logging API call...');
  await logger.logApiCall(
    sessionId,
    { type: 'subagent', id: subagentId },
    'POST /api/activities',
    'POST',
    200
  );

  await sleep(100);

  // Session end
  console.log('📝 [9/9] Logging session end...');
  await logger.logSessionEnd(sessionId);

  // Get summary
  console.log('\n✅ Workflow complete!\n');
  console.log('📊 Retrieving session summary...\n');

  const summary = await logger.getSessionSummary(sessionId);
  if (summary) {
    console.log('Session Summary:');
    console.log(`  Total Actions: ${summary.stats.totalActions}`);
    console.log(`  Success Rate: ${summary.stats.successRate.toFixed(1)}%`);
    console.log(`  Total Tokens: ${summary.stats.totalTokens}`);
    console.log(`  Total Cost: $${summary.stats.totalCost.toFixed(4)}`);
    console.log(`  Duration: ${summary.stats.avgActionDuration.toFixed(0)}ms avg per action`);

    console.log('\nActor Breakdown:');
    Object.entries(summary.actors).forEach(([actorId, stats]) => {
      console.log(`  ${actorId}:`);
      console.log(`    Actions: ${stats.actionsCount}`);
      console.log(`    Cost: $${stats.costUsd.toFixed(4)}`);
      console.log(`    Tokens: ${stats.tokensUsed}`);
    });

    console.log('\nTop Tools:');
    summary.topTools.slice(0, 5).forEach((tool, i) => {
      console.log(`  ${i + 1}. ${tool.name} (${tool.count} calls, $${tool.cost.toFixed(4)})`);
    });
  }

  console.log('\n🎯 Next steps:');
  console.log('1. Start the API server: npm run api');
  console.log('2. Open http://localhost:3001 in your browser');
  console.log('3. Verify activities appear in the dashboard');
  console.log('4. Check cost breakdown matches expected values');
  console.log('\n✨ Dashboard URL: http://localhost:3001\n');

  // Keep connection open briefly
  await sleep(500);
  process.exit(0);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Run the workflow
runTestWorkflow().catch((error) => {
  console.error('❌ Workflow failed:', error);
  process.exit(1);
});
