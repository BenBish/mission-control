# Getting Started with Mission Control Phase 1.5

This guide will get you up and running with the Mission Control Activity Feed and Cost Tracking dashboard.

## Quick Start (5 minutes)

### 1. Start the Dashboard

```bash
cd ~/Dev/openclaw-mission-control
bun run api
```

Output:

```
✨ Activity Feed Server running on http://localhost:3001
📊 Dashboard: http://localhost:3001/dashboard
📡 API: http://localhost:3001/api
```

### 2. Open Browser

Open: **http://localhost:3001**

You should see the Mission Control dashboard with navigation tabs.

### 3. Generate Sample Data (in another terminal)

```bash
cd ~/Dev/openclaw-mission-control
node test-workflow-simple.js
```

Watch the dashboard update in real-time as activities are logged!

## What You'll See

### Activity Feed Tab

- **Live activity list** with real-time updates
- **Search** by description, tool name, or actor
- **Filters** for status, actor type, tool, and date range
- **Click** any activity for detailed view
- Activities show: status, actor, tool, duration, cost, tokens

### Cost Breakdown Tab

- **Summary cards** showing total cost, activities, success rate
- **Interactive charts**:
  - Cost by Actor (bar chart)
  - Cost by Tool Top 10 (horizontal bar)
  - Cost Distribution (pie chart)
  - Action Count by Tool (bar chart)
- **Detailed tables** with actor and tool costs
- Auto-refreshes every 10 seconds

### Activity Detail View

- Full activity metadata
- Tool inputs and outputs
- Token counts and cost breakdown
- Status indicators and timeline
- Error messages if any

## Directory Structure

```
~/Dev/openclaw-mission-control/
├── src/
│   ├── api/               # Express API server
│   ├── db/                # SQLite database layer
│   ├── frontend/          # React dashboard (NEW)
│   ├── logger/            # Activity logging
│   ├── integration/       # OpenClaw hooks (NEW)
│   └── types/             # TypeScript definitions
├── public/
│   └── index.html         # React entry point (NEW)
├── examples/
│   └── test-workflow.ts   # Demo workflow
├── docs/
│   ├── OPENCLAW_INTEGRATION.md  # Integration guide (NEW)
│   ├── API_SPECIFICATION.md
│   └── INTEGRATION_GUIDE.md
├── data/                  # SQLite database files
└── dist/                  # Compiled JavaScript
```

## Available Commands

```bash
# Start API server with dashboard
bun run api

# Build TypeScript to JavaScript
bun run build

# Run test workflow (generates sample data)
node test-workflow-simple.js

# Run full test suite
bun test

# Run tests in watch mode
bun run test:watch

# Check code style
bun run lint
```

## API Endpoints

### Activities

- `GET /api/activities?limit=100&offset=0` - List activities
- `GET /api/activities/:id` - Get activity details
- `GET /api/activities/search?q=query` - Search activities
- `GET /api/pending-activities` - In-progress activities

### Sessions

- `GET /api/sessions/:id` - Session summary
- `GET /api/sessions/:id/activities` - Session activities
- `GET /api/sessions/:id/cost-report` - Session costs

### Reporting

- `GET /api/cost-report` - Overall cost aggregation
- `GET /api/stats` - System statistics

### Real-Time

- `GET /api/stream` - Server-Sent Events for real-time updates
- `GET /api/health` - Server health check

### Frontend

- `GET /` - React dashboard (SPA)

## Integration with OpenClaw

To integrate with your OpenClaw instance, see `docs/OPENCLAW_INTEGRATION.md`.

Quick summary:

```typescript
import {
  EventBasedActivityLogger,
  initializeOpenClawIntegration,
} from "./src/integration/openclaw-hook";

// Initialize
const { logger } = await initializeOpenClawIntegration({
  databasePath: "./data/mission-control.db",
  enableStreaming: true,
  captureTokens: true,
  captureOutput: true,
  maxOutputSize: 5000,
});

// Hook into OpenClaw events
const eventLogger = new EventBasedActivityLogger(logger);

openclawEvents.on("tool:start", (toolName, params, context) => {
  const activityId = eventLogger.onToolStart(
    toolName,
    params,
    context.sessionId,
    context.actor,
  );
  context.activityId = activityId;
});

openclawEvents.on("tool:end", (result, error, context) => {
  eventLogger.onToolEnd(
    context.activityId,
    result,
    error,
    context.durationMs,
    context.metadata,
  );
});
```

## Performance

- Dashboard loads: <2 seconds
- Real-time updates: <500ms latency
- Activity logging: <5ms per action
- Search: <500ms for 1000 activities

## Troubleshooting

### Dashboard won't load

1. **Check server is running:**

   ```bash
   curl http://localhost:3001/api/health
   ```

   Should return: `{"success": true, "status": "healthy"}`

2. **Check database exists:**

   ```bash
   ls -la data/mission-control.db
   ```

3. **Check browser console:**
   Open DevTools (F12) → Console tab → Look for errors

### Activities not appearing

1. **Generate test data:**

   ```bash
   node test-workflow-simple.js
   ```

2. **Check SSE connection:**
   Open DevTools → Network tab → Filter "stream" → Look for `/api/stream`

3. **Check API is working:**
   ```bash
   curl http://localhost:3001/api/activities
   ```

### Costs showing as $0

1. **Verify token extraction:**

   ```bash
   curl http://localhost:3001/api/activities | jq '.activities[0].tokens'
   ```

2. **Check model pricing:**
   Review `src/types/pricing.ts` for your model

3. **Check cost calculation:**
   Review the test workflow output for cost values

## Data Storage

Activities are stored in SQLite:

- Location: `./data/mission-control.db`
- Database mode: WAL (Write-Ahead Logging) for concurrency
- Automatic indexes on common queries
- 7-day retention for dashboard (configurable)

## Configuration

### Environment Variables

```bash
# API Server
PORT=3001
NODE_ENV=development

# Mission Control
MC_DATABASE_PATH="./data/mission-control.db"
MC_ENABLE_STREAMING="true"
MC_CAPTURE_TOKENS="true"
MC_CAPTURE_OUTPUT="true"
MC_MAX_OUTPUT_SIZE="5000"
```

### Model Pricing

Update pricing in `src/types/pricing.ts`:

```typescript
export const MODEL_PRICING: Record<string, PricingTier> = {
  "openrouter/anthropic/claude-haiku-4.5": {
    inputCostPer1kTokens: 0.0008,
    outputCostPer1kTokens: 0.004,
  },
  // Add more models here
};
```

## Next Steps

### 1. Try the Dashboard

- Start server: `bun run api`
- Generate data: `node test-workflow-simple.js`
- Explore: http://localhost:3001

### 2. Integrate with OpenClaw

- Follow: `docs/OPENCLAW_INTEGRATION.md`
- Choose integration pattern (event-based, middleware, or hook)
- Wire up to your tool executor

### 3. Monitor Real Activities

- Run your OpenClaw workflows
- Watch activities appear in dashboard in real-time
- Track costs across different models and agents

### 4. Analyze and Optimize

- Use cost breakdown to identify expensive tools
- Find patterns in agent behavior
- Optimize prompt complexity based on token usage

## Files You Might Need to Know About

### Frontend

- `src/frontend/App.tsx` - Main React component
- `src/frontend/pages/ActivityFeed.tsx` - Activity list
- `src/frontend/pages/CostBreakdown.tsx` - Charts and analytics
- `src/frontend/pages/ActivityDetail.tsx` - Detailed view

### Integration

- `src/integration/openclaw-hook.ts` - Integration patterns
- `docs/OPENCLAW_INTEGRATION.md` - Integration guide

### Backend

- `src/api/server.ts` - Express server
- `src/api/routes.ts` - API endpoints
- `src/logger/activity-logger.ts` - Activity logging
- `src/db/database.ts` - SQLite operations

### Test Data

- `test-workflow-simple.js` - Generates sample activities
- `examples/test-workflow.ts` - Full TypeScript example

## Security Notes

For MVP (current):

- No authentication (local-only)
- Database stored locally
- Activities include tool outputs (consider redacting sensitive data)

For production:

- Add authentication layer
- Implement access control
- Configure data redaction policies
- Enable HTTPS

## Support

Issues or questions?

1. Check the troubleshooting section above
2. Review `docs/OPENCLAW_INTEGRATION.md` for integration help
3. Look at test workflow for usage examples
4. Check API specification in `docs/API_SPECIFICATION.md`

## What's New in Phase 1.5

✨ **React Dashboard** - Beautiful, real-time UI for monitoring activities
🔗 **OpenClaw Integration** - Drop-in hooks for automatic logging
📊 **Cost Analytics** - Interactive charts for cost breakdown
🎯 **Search & Filter** - Find activities quickly
💰 **Token Tracking** - Automatic extraction and cost calculation
⚡ **Real-Time Updates** - Live dashboard with <500ms latency
🧪 **Test Workflow** - Demonstrates end-to-end functionality

## Phase 2 (Planned)

- Multi-user support with authentication
- Advanced analytics (trends, forecasting)
- Cost alerts and notifications
- Team access control
- Data export (CSV, PDF)
- Slack/Discord integration

---

**Happy monitoring! 🎯**
