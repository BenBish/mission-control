# Mission Control Integration Testing Plan

**Status:** 🔄 IN PROGRESS  
**Blocker:** BLOCKER 3 - Integration Testing  
**Target:** Test all 3 integration patterns with real/simulated OpenClaw

## Overview

Need to validate that Mission Control integration works correctly with OpenClaw's actual execution context. This document outlines the testing approach.

## Test Environment Setup

### Option A: Real OpenClaw (Preferred)

- Use Ben's existing OpenClaw setup at `~/.openclaw-team/`
- Hook into actual agent workflows
- Log real tool executions
- Verify dashboard capture

### Option B: Simulated OpenClaw

- Mock OpenClaw execution context
- Simulate tool calls with realistic data
- Test all three integration patterns
- Verify cost accuracy

## Integration Patterns to Test

### Pattern 1: Event-Based (RECOMMENDED)

**How it works:**

- OpenClaw emits events for tool start/end
- Mission Control listens to events
- Activities logged in real-time

**Test Scenario:**

```
1. Hook into OpenClaw event emitter
2. Execute a tool (e.g., `read`, `web_search`, `exec`)
3. Verify activity is captured
4. Verify tokens are extracted
5. Verify cost is calculated
6. Verify real-time update works
```

**Success Criteria:**

- ✅ Activity created before tool returns
- ✅ Model name correctly extracted
- ✅ Tokens counted accurately
- ✅ Cost matches expected value
- ✅ Dashboard updates in <500ms

### Pattern 2: Middleware Wrapper

**How it works:**

- Mission Control wraps the tool executor
- Automatically intercepts all tool calls
- No event infrastructure required

**Test Scenario:**

```
1. Wrap tool executor with middleware
2. Set execution context (sessionId, actor, model)
3. Execute multiple tools
4. Clear context
5. Verify all activities logged
```

**Success Criteria:**

- ✅ All tools intercepted
- ✅ Context properly set/cleared
- ✅ No performance degradation

### Pattern 3: Direct Hook

**How it works:**

- Explicit per-call instrumentation
- Most control over logging
- Requires code changes at each call site

**Test Scenario:**

```
1. Create hook function
2. Wrap each tool call
3. Extract model from result
4. Verify logging accuracy
```

**Success Criteria:**

- ✅ Explicit control maintained
- ✅ All metadata captured
- ✅ No missed calls

## Test Data

### Workflow 1: Simple Read

- Tool: `read` (built-in)
- Input: `{ file_path: './package.json' }`
- Expected: 1 activity, tokens from model inference
- Duration: ~100ms
- Cost: ~$0.001

### Workflow 2: Web Search

- Tool: `web_search`
- Input: `{ query: 'OpenClaw agent' }`
- Expected: 1 activity, varies by search results
- Duration: ~500ms
- Cost: ~$0.01

### Workflow 3: Complex Workflow (Multi-step)

- Orchestrator delegates to subagent
- Subagent does: read + search + analysis
- Expected: 6+ activities (delegation, 3 tools, messages)
- Duration: ~1500ms
- Cost: ~$0.05

## Test Implementation

### Test 1: Event-Based Pattern

**File:** `src/__tests__/integration-event-based.test.ts`

```typescript
describe("Integration: Event-Based Pattern", () => {
  let logger: ActivityLogger;
  let eventEmitter: EventEmitter;

  beforeAll(async () => {
    // Initialize
    const db = new Database("./test-data/integration-event.db");
    await db.initialize();
    logger = new ActivityLogger(db);
    eventEmitter = new EventEmitter();
  });

  test("should log tool execution from events", async (done) => {
    const sessionId = "test:integration:event-1";
    const eventLogger = new EventBasedActivityLogger(logger);

    // Hook into events
    eventEmitter.on("tool:start", (...args) =>
      eventLogger.onToolStart(...args),
    );
    eventEmitter.on("tool:end", (...args) => eventLogger.onToolEnd(...args));

    // Verify activity created
    logger.once("activity:created", (activity) => {
      expect(activity.actionType).toBe("tool_call");
      expect(activity.toolName).toBe("read");
      done();
    });

    // Emit tool execution
    eventEmitter.emit(
      "tool:start",
      "read",
      { file: "test.txt" },
      sessionId,
      actor,
    );
    await new Promise((r) => setTimeout(r, 100));
    eventEmitter.emit("tool:end", { content: "..." }, null, {
      ...context,
      durationMs: 100,
    });
  });

  test("should extract model and calculate cost", async () => {
    // Execute workflow
    // Verify model extracted
    // Verify cost calculated
  });

  test("should update dashboard in real-time", async () => {
    // Execute tool
    // Verify SSE event emitted
    // Verify latency <500ms
  });
});
```

### Test 2: Middleware Pattern

**File:** `src/__tests__/integration-middleware.test.ts`

```typescript
describe("Integration: Middleware Pattern", () => {
  test("should wrap tool executor", async () => {
    const middleware = new OpenClawInstrumentationMiddleware(logger);
    const wrapped = middleware.wrapToolExecutor(originalExecutor);

    // Set context
    middleware.setExecutionContext(sessionId, actor, "claude-3");

    // Execute
    const result = await wrapped("read", { file: "test.txt" });

    // Verify
    const activity = await logger.getActivity(activityId);
    expect(activity.tokens.model).toBe("claude-3");
  });

  test("should handle multiple sequential calls", async () => {
    // Execute 3 tools
    // Verify all logged
    // Verify context isolated
  });

  test("should not interfere with errors", async () => {
    // Execute tool that throws
    // Verify error logged
    // Verify context cleaned up
  });
});
```

### Test 3: Direct Hook

**File:** `src/__tests__/integration-hook.test.ts`

```typescript
describe("Integration: Direct Hook", () => {
  test("should manually instrument tool call", async () => {
    const hook = createToolExecutionHook(logger);

    const context = {
      toolName: "read",
      params: { file: "test.txt" },
      actor: { type: "subagent", id: "test" },
      sessionId: "session",
    };

    const result = await hook(context, async () => {
      return { content: "..." };
    });

    expect(result.content).toBe("...");
  });

  test("should extract tokens from result", async () => {
    // Execute hook with API result
    // Verify tokens extracted
    // Verify cost calculated
  });
});
```

## Validation Checklist

### Model Extraction ✓

- [ ] Model extracted from API response
- [ ] Model extracted from context
- [ ] Model extracted from environment
- [ ] Fallback to default model
- [ ] Warning logged if not found

### Token Counting

- [ ] Input tokens counted
- [ ] Output tokens counted
- [ ] Total tokens accurate
- [ ] Handles OpenRouter format
- [ ] Handles OpenAI format

### Cost Calculation

- [ ] Cost matches pricing table
- [ ] Cost formula: (tokens / 1000) \* price
- [ ] Breakdown shows input/output costs
- [ ] Zero cost for unknown model
- [ ] Matches dashboard

### Real-Time Updates

- [ ] SSE event emitted
- [ ] Latency <500ms
- [ ] Dashboard updates correctly
- [ ] Polling fallback works
- [ ] No duplicate events

### Activity Tracking

- [ ] Tool call logged
- [ ] Delegation logged
- [ ] Agent spawn logged
- [ ] Messages logged
- [ ] Session lifecycle tracked

### Error Handling

- [ ] Tool failures captured
- [ ] Timeouts handled
- [ ] Missing model doesn't break logging
- [ ] Database errors logged
- [ ] Context cleaned up on error

## Success Criteria

### Pattern 1 (Event-Based)

- [x] Compiles without errors
- [ ] Events hook successfully
- [ ] Activities created in <100ms
- [ ] All metadata captured
- [ ] Cost accurate within 5%
- [ ] Real-time dashboard working

### Pattern 2 (Middleware)

- [x] Compiles without errors
- [ ] Executor intercepted
- [ ] Context isolated between calls
- [ ] Error handling works
- [ ] Performance: <5ms overhead
- [ ] No memory leaks

### Pattern 3 (Direct Hook)

- [x] Compiles without errors
- [ ] Manual instrumentation works
- [ ] Model extraction reliable
- [ ] Token counting accurate
- [ ] Cost calculation correct

## Known Issues & Limitations

### Testing with Real OpenClaw

- **Access:** Requires Ben's OpenClaw setup running
- **Complexity:** May need to mock certain interactions
- **Timing:** Real workflows can take several seconds
- **Network:** If OpenClaw is remote, latency affects timing

### Model Extraction

- **Challenge:** Different APIs return model differently
- **Solution:** Comprehensive extraction function handles variations
- **Fallback:** Default model + warnings if not found

### Dashboard Testing

- **Browser Automation:** May need Puppeteer or Playwright
- **Real-Time:** Testing SSE requires keeping connection open
- **Performance:** Timing-dependent, may need retries

## Testing Timeline

1. **Unit Tests** (Done) ✅
   - Model extraction working
   - Jest configured
   - 15/17 tests passing

2. **Integration Scenarios** (Now)
   - Event-based pattern simulation
   - Middleware pattern simulation
   - Direct hook pattern simulation

3. **Real OpenClaw Testing** (Optional)
   - Hook into actual OpenClaw setup
   - Execute real workflows
   - Verify end-to-end accuracy

4. **Dashboard Verification** (Optional)
   - Automated browser tests
   - SSE real-time updates
   - Cost display accuracy

## Next Steps

1. Create integration test files in `src/__tests__/integration-*.test.ts`
2. Implement mock OpenClaw context
3. Run tests and verify all patterns work
4. Document any integration friction
5. If real OpenClaw available, test against live setup
6. Create integration troubleshooting guide

## Questions for Integration

1. **Event Emitter Location** - Where in OpenClaw does tool execution emit events?
2. **Context Structure** - What fields available in execution context?
3. **Model Information** - Where/how is model name provided?
4. **Response Format** - What do tool results look like?
5. **Session Tracking** - How to get current session ID?
6. **Agent Info** - Where stored: actor type, ID, role?
7. **Timing** - When do events fire relative to execution?
8. **Error Handling** - How are tool errors communicated?

## Resources

- OpenClaw API: `~/.openclaw-team/`
- Mission Control: `~/Dev/openclaw-mission-control/`
- Test Data: `data/`
- Dashboard: http://localhost:3001 (when running)
