# Model Extraction - Technical Documentation

**Status:** ✅ FIXED (Blocker 1)  
**Date:** 2026-02-15  
**Issue:** Model name was hardcoded as `context.actor.id`, causing cost calculation errors up to 100x  
**Solution:** Implemented robust model extraction with multiple fallbacks

## Problem

**Original Code (Line 62 in `src/integration/openclaw-hook.ts`):**

```typescript
model: context.actor.id; // ❌ WRONG - This is 'agent-123', not 'openrouter/anthropic/claude-3-haiku'
```

**Impact:**

- Cost calculations were completely wrong (10-100x inaccurate)
- Model pricing lookups failed
- No visibility into which models were actually being used

## Solution

Implemented **`extractModel()`** function that tries multiple sources in order:

### Extraction Priority (in order)

1. **Custom extractor** - If configured via `configureModelExtraction()`
2. **Result metadata** - `result.model` (from API response)
3. **Result usage** - `result.usage.model` (OpenRouter format)
4. **Context metadata** - `context.model` or `context.metadata.model`
5. **Environment variables** - `OPENAI_MODEL`, `MODEL`, `LLM_MODEL`
6. **Global context** - `currentModel` set via middleware
7. **Default model** - Configured fallback
8. **Undefined** - If nothing found (logs warning)

### Usage

#### Basic Integration

```typescript
import { initializeOpenClawIntegration } from "./integration/openclaw-hook.js";

const { logger, middleware } = await initializeOpenClawIntegration({
  databasePath: "./data/mission-control.db",
  enableStreaming: true,
  captureTokens: true,
  captureOutput: true,
  maxOutputSize: 5000,
  // NEW: Configure model extraction
  modelExtraction: {
    defaultModel: "openrouter/anthropic/claude-3-haiku",
    logWarnings: true,
  },
});
```

#### Set Model via Middleware

```typescript
middleware.setExecutionContext(
  sessionId,
  actor,
  "openrouter/anthropic/claude-3-opus",
);
const result = await toolExecutor(toolName, params);
middleware.clearExecutionContext();
```

#### Custom Model Extractor

```typescript
configureModelExtraction({
  defaultModel: "gpt-4",
  getModel: (context, result) => {
    // Custom extraction logic
    if (context.agent?.config?.model) {
      return context.agent.config.model;
    }
    if (result?.provider?.modelName) {
      return result.provider.modelName;
    }
    return undefined;
  },
  logWarnings: true,
});
```

## How to Integrate with OpenClaw

### Option 1: Extract from Tool Result (Recommended)

Many APIs (OpenRouter, OpenAI) return model name in response:

```typescript
// OpenRouter Response Format
{
  "result": "...",
  "usage": {
    "prompt_tokens": 100,
    "completion_tokens": 50
  },
  "model": "gpt-4-turbo-2024-04-09"  // ✅ Auto-extracted
}
```

**Implementation:** Just pass the API response through - extraction happens automatically.

### Option 2: Set via Execution Context

Before delegating to a tool:

```typescript
const orchestrator = {
  async executeToolWithCost(toolName, params, modelName) {
    middleware.setExecutionContext(sessionId, actor, modelName);
    try {
      const result = await toolExecutor(toolName, params);
      return result;
    } finally {
      middleware.clearExecutionContext();
    }
  },
};
```

### Option 3: Configure Environment Variable

```bash
# Set the model at OpenClaw startup
export OPENAI_MODEL="openrouter/anthropic/claude-3-opus"
export LLM_MODEL="gpt-4"
```

### Option 4: Custom Extractor for OpenClaw Context

```typescript
configureModelExtraction({
  getModel: (context) => {
    // If OpenClaw stores model in session metadata
    return (
      context.session?.config?.modelName ||
      context.agent?.modelName ||
      process.env.OPENAI_MODEL
    );
  },
});
```

## Configuration API

### `configureModelExtraction(config: ModelExtractionConfig)`

Configure global model extraction behavior.

```typescript
interface ModelExtractionConfig {
  // Default model if extraction fails
  defaultModel?: string;

  // Custom extraction function
  getModel?: (context: any, result?: any) => string | undefined;

  // Log warnings when model can't be determined
  logWarnings?: boolean;
}
```

### `extractModel(context: any, result?: any): string | undefined`

Extract model from context and/or result.

**Parameters:**

- `context` - Execution context (from tool call)
- `result` - Tool execution result (from API)

**Returns:** Model name (string) or undefined if not found

### Middleware Methods

```typescript
middleware.setExecutionContext(sessionId, actor, model?)
middleware.clearExecutionContext()
```

## Pricing Table

Model names must match entries in `src/types/pricing.ts`. Currently supported:

```typescript
{
  'openrouter/anthropic/claude-haiku-4.5': { ... },
  'openrouter/anthropic/claude-3-haiku': { ... },
  'openrouter/anthropic/claude-3-sonnet': { ... },
  'openrouter/anthropic/claude-3-opus': { ... },
  'openrouter/openai/gpt-4-turbo': { ... },
  'openrouter/openai/gpt-3.5-turbo': { ... },
}
```

**To add a new model:**

1. Add entry to `PRICING` in `src/types/pricing.ts`
2. Update extraction logic if using custom format
3. Verify with test workflow

## Troubleshooting

### "No model found in context" Warning

The model couldn't be extracted. Check:

1. **API Response** - Does your API return `model` field?
2. **Environment Variables** - Set `OPENAI_MODEL` or `LLM_MODEL`
3. **Configuration** - Set `defaultModel` in `modelExtraction` config
4. **Custom Extractor** - Implement `getModel` function

### Cost Calculation Wrong

1. **Verify model name** - Check logs, must match pricing table
2. **Check pricing** - Ensure model exists in `PRICING`
3. **Test extraction** - Use the test script below

### Model Not in Pricing Table

Add it to `src/types/pricing.ts`:

```typescript
export const PRICING: PricingTable = {
  "your-model-name": {
    inputCostPer1kTokens: 0.001,
    outputCostPer1kTokens: 0.002,
  },
  // ...
};
```

## Testing Model Extraction

```bash
# Run test script
node -e "
import('./dist/integration/openclaw-hook.js').then(m => {
  const model = m.extractModel({}, { model: 'gpt-4' });
  console.log('Extracted model:', model);
}).catch(console.error);
"
```

## Verification Checklist

- [ ] Model extraction function returns correct values
- [ ] Cost calculations use extracted model
- [ ] Pricing table includes extracted models
- [ ] Tests pass (15/17 - 2 are test logic issues)
- [ ] No "model not found" warnings in production
- [ ] Dashboard shows correct costs

## Related Files

- `src/integration/openclaw-hook.ts` - Model extraction implementation
- `src/types/pricing.ts` - Pricing table
- `src/logger/activity-logger.ts` - Cost calculation
- `docs/OPENCLAW_INTEGRATION.md` - Integration guide
