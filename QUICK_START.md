# Quick Start Guide

Get Mission Control Activity Feed running in 5 minutes.

## Installation

```bash
cd ~/Dev/openclaw-mission-control
npm install
```

## Run the API Server

```bash
npm run api
```

Server starts at `http://localhost:3001`

## Example Usage

In another terminal:

```bash
# Initialize database and run example
node --loader ts-node/esm examples/basic-usage.ts
```

This will:
1. Create a session
2. Log a tool execution
3. Add token and cost information
4. Print session summary

## Check the Data

```bash
# Get session summary
curl http://localhost:3001/api/sessions/agent:main:session:001

# List all activities
curl http://localhost:3001/api/activities

# Get cost report
curl http://localhost:3001/api/cost-report

# Check stats
curl http://localhost:3001/api/stats
```

## Run Tests

```bash
npm test
```

## Key Files

- **Logger API:** `src/logger/activity-logger.ts`
- **Database:** `src/db/database.ts`
- **API Server:** `src/api/server.ts`
- **Example:** `examples/basic-usage.ts`
- **README:** `README.md` (full documentation)

## Next: Integrate with OpenClaw

See `docs/INTEGRATION_GUIDE.md` for hooking into OpenClaw tool execution.

## Documentation

- **README.md** - Full documentation
- **docs/INTEGRATION_GUIDE.md** - OpenClaw integration
- **docs/API_SPECIFICATION.md** - API endpoint reference
- **docs/DEPLOYMENT.md** - Production deployment
- **PHASE_1_SUMMARY.md** - Project overview

## Common Tasks

### Log a tool execution

```typescript
import { Database } from './src/db/database.js';
import { ActivityLogger } from './src/logger/activity-logger.js';

const db = new Database('./data/mission-control.db');
await db.initialize();
const logger = new ActivityLogger(db);

const sessionId = 'my-session-123';
await logger.logSessionStart(sessionId);

const activityId = await logger.logToolStart(
  sessionId,
  { type: 'subagent', id: 'agent-1', role: 'Engineer' },
  'exec',
  { command: 'echo hello' },
  'Running echo command'
);

// Simulate work
await new Promise(r => setTimeout(r, 100));

await logger.logToolEnd(activityId, 'success', {}, 'hello', undefined, 100);

await logger.logSessionEnd(sessionId);
```

### Query activities

```typescript
const activities = await db.getActivities({
  sessionId,
  status: 'success',
  limit: 10
});
```

### Get session summary

```typescript
const summary = await logger.getSessionSummary(sessionId);
console.log(`Cost: $${summary.stats.totalCost}`);
console.log(`Tokens: ${summary.stats.totalTokens}`);
console.log(`Success rate: ${summary.stats.successRate}%`);
```

## Environment Variables

Copy `.env.example` to `.env` and adjust:

```bash
cp .env.example .env
```

Key variables:
- `PORT` - API server port (default: 3001)
- `DATABASE_PATH` - SQLite database location
- `NODE_ENV` - development or production

## Troubleshooting

**"Port already in use"**
```bash
lsof -i :3001
kill -9 <PID>
```

**"Module not found"**
```bash
npm install
npm run build
```

**"Database locked"**
```bash
# Check if another process is using it
# Kill the process and restart
```

## Next Steps

1. Read `docs/INTEGRATION_GUIDE.md` to hook into OpenClaw
2. Read `README.md` for complete documentation
3. Explore `docs/API_SPECIFICATION.md` for all endpoints
4. Run `npm test` to verify everything works

---

For more details, see README.md or the docs/ folder.
