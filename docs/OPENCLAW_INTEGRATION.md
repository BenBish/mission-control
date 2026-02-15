# OpenClaw Integration Guide

This document explains how to integrate Mission Control activity logging into OpenClaw.

## Overview

Mission Control provides automatic activity tracking for all tool executions in OpenClaw. By integrating the instrumentation layer, every action performed by agents (both orchestrator and subagents) will be captured, logged, and made available in the dashboard.

## What Gets Logged

- **Tool calls**: Every tool execution with inputs, outputs, duration
- **Agent delegations**: When orchestrator delegates to subagents
- **Agent spawns**: When new subagents are created
- **Token usage**: From API responses (when available)
- **Costs**: Automatically calculated based on model and token counts
- **User requests**: Top-level user input
- **API calls**: Inter-process API calls
- **Messages**: Agent-to-agent and user-agent messaging

## Integration Methods

### Method 1: Event-Based (Recommended)

If OpenClaw has an event emitter for tool execution, use the `EventBasedActivityLogger`:

```typescript
import { ActivityLogger } from 'mission-control-activity-feed';
import { EventBasedActivityLogger, initializeOpenClawIntegration } from 'mission-control-activity-feed/integration';

// On OpenClaw startup
const { logger, middleware, db } = await initializeOpenClawIntegration({
  databasePath: './data/mission-control.db',
  enableStreaming: true,
  captureTokens: true,
  captureOutput: true,
  maxOutputSize: 5000,
});

// Register event listeners
const eventLogger = new EventBasedActivityLogger(logger);

// Hook into OpenClaw's event bus (example - adjust to actual API)
openclawEvents.on('tool:start', (toolName, params, context) => {
  const activityId = eventLogger.onToolStart(
    toolName,
    params,
    context.sessionId,
    context.actor
  );
  context.activityId = activityId; // Store for later
});

openclawEvents.on('tool:end', (result, error, context) => {
  eventLogger.onToolEnd(
    context.activityId,
    result,
    error,
    context.durationMs,
    context.metadata
  );
});

openclawEvents.on('agent:delegation', (fromActor, toAgent, context) => {
  eventLogger.onDelegation(
    context.sessionId,
    context.parentActivityId,
    fromActor,
    toAgent
  );
});
```

### Method 2: Middleware Wrapper (Direct Tool Execution)

If you control the tool executor directly, wrap it with middleware:

```typescript
import { OpenClawInstrumentationMiddleware, initializeOpenClawIntegration } from 'mission-control-activity-feed/integration';

const { logger, middleware } = await initializeOpenClawIntegration({
  databasePath: './data/mission-control.db',
  enableStreaming: true,
  captureTokens: true,
  captureOutput: true,
  maxOutputSize: 5000,
});

// Wrap the tool executor
const instrumentedExecutor = middleware.wrapToolExecutor(originalToolExecutor);

// Set execution context before each call
middleware.setExecutionContext(sessionId, {
  type: 'subagent',
  id: agentId,
  role: 'Engineer',
});

// Now use instrumentedExecutor instead of originalToolExecutor
const result = await instrumentedExecutor(toolName, params);

// Clean up context
middleware.clearExecutionContext();
```

### Method 3: Direct Hook Integration

For the most control, use the low-level hook:

```typescript
import { createToolExecutionHook, ToolExecutionContext } from 'mission-control-activity-feed/integration';

const hook = createToolExecutionHook(logger);

// Before each tool execution:
const result = await hook(
  {
    toolName: 'exec',
    params: { command: 'git status' },
    actor: { type: 'subagent', id: 'engineer-001', role: 'Engineer' },
    sessionId: 'agent:main:subagent:xyz',
  },
  async (params) => {
    // Call the original tool here
    return await toolExecutor.exec(params);
  }
);
```

## Configuration

### Environment Variables

```bash
# Mission Control activity logging
export MC_DATABASE_PATH="./data/mission-control.db"
export MC_ENABLE_STREAMING="true"
export MC_CAPTURE_TOKENS="true"
export MC_CAPTURE_OUTPUT="true"
export MC_MAX_OUTPUT_SIZE="5000"

# API Server
export MC_API_PORT="3001"
```

### Configuration Object

```typescript
interface OpenClawIntegrationConfig {
  // Path to SQLite database for activities
  databasePath: string;
  
  // Enable real-time SSE streaming to dashboard
  enableStreaming: boolean;
  
  // Extract token counts from API responses
  captureTokens: boolean;
  
  // Log tool outputs (can be verbose)
  captureOutput: boolean;
  
  // Max characters of output to store (prevents storage bloat)
  maxOutputSize: number;
}
```

## Token Extraction

Mission Control automatically extracts token counts from API responses. Supported formats:

### OpenRouter API
```json
{
  "usage": {
    "prompt_tokens": 100,
    "completion_tokens": 50
  }
}
```

### Generic API Response
```json
{
  "tokens": {
    "inputTokens": 100,
    "outputTokens": 50,
    "model": "gpt-4"
  }
}
```

To add support for additional API formats, extend the token extraction logic in `logToolWithTokens()`:

```typescript
// In src/logger/activity-logger.ts
const tokens = extractTokensFromResult(result);
if (tokens) {
  await logger.logToolWithTokens(activityId, tokens);
}
```

## Cost Calculation

Costs are automatically calculated based on token counts and model pricing. Configure pricing in:

```typescript
// src/types/pricing.ts
export const MODEL_PRICING: Record<string, PricingTier> = {
  'openrouter/anthropic/claude-3-opus': {
    inputCostPer1kTokens: 0.015,
    outputCostPer1kTokens: 0.075,
  },
  // Add more models as needed
};
```

## Real-Time Dashboard Updates

Once integrated, all activities will automatically stream to connected dashboard clients via Server-Sent Events (SSE).

To view the dashboard:
1. Start the API server: `npm run api`
2. Open http://localhost:3001 in browser
3. Activities appear in real-time as they're logged

## Testing Integration

### 1. Create a test agent workflow

```typescript
// test-workflow.ts
import { initializeOpenClawIntegration } from './integration/openclaw-hook';

const { logger } = await initializeOpenClawIntegration({
  databasePath: './data/test.db',
  enableStreaming: true,
  captureTokens: true,
  captureOutput: true,
  maxOutputSize: 5000,
});

// Log a session
const sessionId = 'test-session-001';
await logger.logSessionStart(sessionId);

// Log some activities
const activityId = await logger.logToolStart(
  sessionId,
  { type: 'subagent', id: 'test-agent', role: 'Engineer' },
  'read',
  { file_path: './package.json' },
  'Reading package.json'
);

// Simulate tool execution
await new Promise(r => setTimeout(r, 1000));

await logger.logToolEnd(
  activityId,
  'success',
  null,
  '{"name": "mission-control-activity-feed", ...}',
  undefined,
  1250
);

// Log tokens and cost
await logger.logToolWithTokens(activityId, {
  inputTokens: 100,
  outputTokens: 50,
  model: 'openrouter/anthropic/claude-haiku-4.5',
});

// End session
await logger.logSessionEnd(sessionId);

console.log('Test workflow complete. Check http://localhost:3001');
```

### 2. Run the dashboard

```bash
npm run api
# Open http://localhost:3001 in browser
```

### 3. Verify activities appear in dashboard

- Activity feed shows all logged actions
- Cost breakdown is calculated correctly
- Real-time updates appear as activities complete

## Troubleshooting

### Activities not appearing in dashboard

1. **Check database is initialized:**
   ```bash
   ls -la ./data/mission-control.db
   ```

2. **Check logs for errors:**
   ```bash
   # Enable debug logging
   DEBUG=mission-control:* npm run api
   ```

3. **Verify SSE connection:**
   Open browser DevTools → Network → Filter by "stream" → check /api/stream

4. **Check API health:**
   ```bash
   curl http://localhost:3001/api/health
   ```

### Token counts not captured

1. Verify `captureTokens: true` in config
2. Check that API response includes `usage` or `tokens` field
3. Add custom token extraction for your API format

### Costs showing as $0

1. Verify model pricing is configured in `src/types/pricing.ts`
2. Check that tokens are being extracted correctly
3. Verify model name matches pricing table

## Performance Considerations

- **Activity logging**: <5ms per tool call (mostly async)
- **Database writes**: Batched for efficiency
- **Dashboard updates**: ~50ms latency for SSE broadcasts
- **Storage**: ~1 KB per activity record

For high-volume workloads (>1000 activities/min), consider:
- Using PostgreSQL instead of SQLite
- Enabling write batching (every 100 activities)
- Archiving old activities to cold storage

## Data Privacy

Mission Control logs **everything** about tool execution, including:
- Tool inputs (may include sensitive data)
- Tool outputs (may include PII)
- Error messages (may leak internal paths or secrets)

To redact sensitive data:

```typescript
// Before logging
const sanitized = sanitizeActivityData(activity);
await logger.log(sanitized);

// Implement sanitization
function sanitizeActivityData(activity: Activity): Activity {
  return {
    ...activity,
    details: {
      ...activity.details,
      // Remove sensitive fields
      apiKey: '[REDACTED]',
      password: '[REDACTED]',
    },
  };
}
```

## Support

For integration issues:
1. Check this guide and examples
2. Review the test workflow in `examples/test-workflow.ts`
3. Check logs and API health endpoint
4. Review the ActivityLogger and Database types

## Next Steps

After integration:
1. Run test workflows to verify logging
2. Monitor dashboard for activity feed
3. Validate cost calculations
4. Configure retention policies
5. Set up log archival for long-term storage
