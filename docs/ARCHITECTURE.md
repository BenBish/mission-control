# Mission Control Architecture

## Overview
Mission Control is a unified observability platform for tracking AI agent activities, costs, and performance metrics across OpenClaw agent systems.

## Core Components

```
OpenClaw Agents ──▶ Bridge Plugin ──▶ Mission Control API ──▶ SQLite DB
                                           │
                                           ▼
                                    Vite React Dashboard
```

### Data Flow
1. **Agent Execution** → OpenClaw agents execute tools and LLM calls
2. **Log Capture** → Bridge plugin forwards activities or Scanner reads JSONL logs
3. **Database Storage** → SQLite stores activities, sessions, and LLM generations
4. **API Layer** → Express server provides REST API and SSE streaming
5. **Dashboard** → React frontend visualizes data in real-time

## Backend Architecture

### API Layer (`src/api/`)

#### File Structure
```
src/api/
├── server.ts    # Express server, middleware, initialization
└── routes.ts    # Route definitions and handlers
```

#### Route Organization
```
setupRoutes(app, logger)
├── Activity Endpoints
│   ├── GET  /api/activities          # List with filters
│   ├── POST /api/activities          # Create from plugin
│   ├── GET  /api/activities/:id      # Get single activity
│   └── GET  /api/activities/search   # Full-text search
├── Session Endpoints
│   ├── GET  /api/sessions/:id        # Session summary
│   ├── GET  /api/sessions/:id/activities
│   └── GET  /api/sessions/:id/cost-report
├── Aggregation Endpoints
│   ├── GET  /api/cost-report         # Overall cost aggregation
│   └── GET  /api/stats               # System statistics
├── Cost/LLM Generation Endpoints
│   ├── POST /api/cost/scan           # Trigger incremental scan
│   ├── POST /api/cost/backfill       # Full historical scan
│   ├── GET  /api/cost/generations    # List LLM generations
│   ├── GET  /api/cost/summary        # Aggregated cost by agent/model
│   └── GET  /api/cost/status         # Scanner health
├── Health Endpoints
│   └── GET  /api/health              # Health check
└── Streaming Endpoints
    └── GET  /api/stream              # SSE real-time updates
```

#### SSE (Server-Sent Events)

The `/api/stream` endpoint provides real-time activity streaming:

```typescript
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  sseClients.add(res);
  
  // Heartbeat every 30s
  const heartbeatInterval = setInterval(() => {
    res.write(':heartbeat\n\n');
  }, 30000);
});
```

**Features:**
- Persistent connections for live dashboard updates
- Heartbeat messages prevent timeout
- Activity events broadcast on `activity:created` and `activity:updated`

---

### Services (`src/services/`)

**Note:** Directory was cleaned in ORC-8. Intended architecture described below.

#### `session-log-scanner.ts`

**Purpose:** Incrementally scan OpenClaw session JSONL files to extract LLM generation data with exact costs.

**How It Works:**
1. **File Discovery:** Glob pattern `~/.openclaw-team/agents/*/sessions/*.jsonl`
2. **Incremental Scanning:** Uses `scan_state` table to track file offsets
3. **JSONL Parsing:** Reads line-by-line, parses each JSON record
4. **Generation Extraction:** Identifies `llm_response` messages
5. **Upsert to Database:** Stores in `llm_generations` table
6. **Scheduled Execution:** Runs periodically

**Why Critical:**
- Provides exact costs from LLM provider APIs (not estimates)
- Enables cost attribution to specific agents and models
- Supports cache hit tracking for optimization analysis
- Historical backfill capability

#### `cost-linker.ts`

**Purpose:** Link LLM generation records to activity records for unified cost attribution.

**Functionality:**
1. Queries unlinked generations from `llm_generations` table
2. Matches to activities by session ID, timestamp proximity, agent ID
3. Updates activity records with cost and token information
4. Marks generations as linked

---

### Logger (`src/logger/`)

**Note:** Directory was cleaned in ORC-8.

#### `activity-logger.ts`

**Purpose:** Core logging interface for recording agent activities.

**Key Capabilities:**
- EventEmitter-based (emits `activity:created`, `activity:updated`)
- Supports all ActionType values: tool_call, delegation, api_call, decision, message, event, user_request, agent_spawn, session_start/end

**Event Flow:**
```typescript
logger.emit('activity:created', activity);
logger.on('activity:created', (activity) => {
  app.locals.broadcastActivity(activity);
});
```

---

### Database (`src/db/`)

#### File Structure
```
src/db/
├── database.ts    # Database class with CRUD operations
├── schema.ts      # SQL schema definitions
└── migrations.ts  # Migration runner
```

#### Key Tables

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `activities` | Core activity records | id, session_id, actor_id, action_type, status, tokens, cost_usd |
| `sessions` | Session metadata | id, start_time, end_time, total_cost_usd |
| `llm_generations` | Exact LLM costs from logs | model, cost_total, cache_read_tokens |
| `scan_state` | Incremental scan tracking | file_path, last_offset |
| `cost_summaries` | Aggregated cost data | session_id, actor_id, summary_date |

#### Schema Snippet
```sql
CREATE TABLE activities (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  tool_name TEXT,
  description TEXT NOT NULL,
  status TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  cost_usd REAL
);

CREATE TABLE llm_generations (
  id TEXT PRIMARY KEY,
  session_log_file TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cache_read_tokens INTEGER DEFAULT 0,
  cost_total REAL DEFAULT 0,
  linked_activity_id TEXT
);
```

---

### Pricing System

Mission Control uses a **two-tier pricing system**:

1. **Exact Costs from Logs:**
   - Extracted from OpenRouter API responses in JSONL logs
   - Stored in `llm_generations.cost_total`
   - Includes cache read/write pricing
   - Most accurate when available

2. **Fallback Static Pricing:**
   - Used when exact costs unavailable
   - Defined in `src/types/pricing.ts`
   - Per-model pricing tiers
   - Updated periodically from OpenRouter

---

## Frontend Architecture

### Vite App (`src/app/`)

**Stack:**
- React 19 + TypeScript
- Tailwind CSS 4.x
- shadcn/ui components
- React Router 7
- Lucide React icons

#### File Structure
```
src/
├── app/
│   ├── providers.tsx    # Theme provider (light/dark/system)
│   └── router.tsx       # React Router configuration
├── pages/
│   ├── DashboardPage.tsx    # Overview stats & recent activity
│   ├── ActivityFeed.tsx     # Tabular activity list
│   ├── ActivityDetail.tsx   # Individual activity view
│   └── CostBreakdown.tsx    # Cost analysis by actor/tool/model
├── components/
│   ├── ui/              # shadcn/ui components
│   └── _shared/         # Layout, Header, Loading, ErrorBoundary
├── types/
│   └── activity.ts      # TypeScript type definitions
└── lib/
    └── utils.ts         # Utility functions (cn helper)
```

#### Key Pages

| Page | Route | Purpose |
|------|-------|---------|
| DashboardPage | `/` | Overview stats, recent activity cards, quick actions |
| ActivityFeed | `/activities` | Tabular list of all activities with filtering |
| ActivityDetail | `/activities/:id` | Detailed view of single activity |
| CostBreakdown | `/costs` | Cost analysis by actor, tool, and model |

#### API Client Integration

All pages use **native fetch** for API calls:

```typescript
// Example from DashboardPage.tsx
const [statsRes, activitiesRes] = await Promise.all([
  fetch("/api/stats"),
  fetch("/api/activities?limit=5"),
]);
```

**No separate API client** - direct fetch calls keep it simple.

---

## Integration Points

### OpenClaw Session Logs

#### Where Logs Are Stored
```
~/.openclaw-team/
└── agents/
    ├── main/
    │   └── sessions/
    │       └── sessions.json
    ├── engineer/
    │   └── sessions/
    │       └── *.jsonl
    └── [agent-name]/
        └── sessions/
            └── *.jsonl
```

#### JSONL Format
Each line is a JSON object:
```json
{
  "type": "llm_response",
  "timestamp": "2026-02-18T23:05:00Z",
  "agentId": "agent:main:main",
  "model": "openrouter/anthropic/claude-sonnet-4.5",
  "usage": {
    "prompt_tokens": 1000,
    "completion_tokens": 500,
    "total_tokens": 1500
  },
  "cost": {
    "input_cost": 0.003,
    "output_cost": 0.015,
    "total_cost": 0.018
  }
}
```

#### How Scanner Reads Them
1. Glob finds all `*.jsonl` files
2. Checks `scan_state` for last offset
3. Reads new lines since last scan
4. Parses JSON and extracts generations
5. Upserts to `llm_generations` table
6. Updates scan state with new offset

---

### Mission Control Bridge

#### What Is The Bridge?
The **Mission Control Bridge** is an OpenClaw extension plugin that forwards agent activities to Mission Control in real-time.

**Location:** `~/.openclaw-team/workspace/.openclaw/extensions/mission-control-bridge/`

#### How It Connects
1. OpenClaw loads the Bridge as an extension
2. Bridge intercepts tool calls and agent events
3. Transforms events to Mission Control activity format
4. POSTs to `/api/activities` endpoint
5. Activities appear in dashboard immediately via SSE

#### Configuration
```json
// package.json
{
  "openclaw": {
    "extensions": ["./index.js"]
  }
}
```

---

## ORC-8 Review

### What Was Cleaned

#### 1. `src/frontend/` (Old React Frontend)
**Why Safe to Delete:**
- Replaced by new Vite + React frontend in `src/app/` and `src/pages/`
- Old frontend used different build system (likely Create React App)
- New frontend uses modern stack: Vite, Tailwind 4, shadcn/ui
- No references to old frontend in active code

#### 2. `src/__tests__/` (Legacy Tests)
**Impact:**
- Jest configuration still exists (`jest.config.js`, `jest.setup.js`)
- No test files in current codebase
- Tests need to be rewritten for new architecture
- Currently no automated testing

#### 3. `src/integration/` (Old Integration)
**What It Did:**
- Contained OpenClaw integration hooks
- Provided middleware for instrumenting tool calls
- Three methods: Event-based, Middleware wrapper, Direct hooks
- Replaced by Bridge plugin architecture

#### 4. `examples/` 
**Purpose:**
- Example workflows demonstrating integration
- Test files for manual validation
- Not essential for production

### What Was Preserved

#### Essential Files Restored

| File | Why Essential | Dependencies |
|------|---------------|--------------|
| `src/api/server.ts` | Main Express server | Database, Logger, Scanner, Linker |
| `src/api/routes.ts` | All API endpoints | Database, Logger |
| `src/db/database.ts` | Database operations | sqlite, schema |
| `src/db/schema.ts` | Table definitions | - |
| `src/types/activity.ts` | Type definitions | Used by API and frontend |
| `src/pages/*.tsx` | Dashboard pages | React Router, UI components |
| `src/app/router.tsx` | Route configuration | All pages |
| `src/components/ui/*.tsx` | shadcn components | Tailwind, Radix |

#### Dependencies Between Components
```
server.ts
├── routes.ts
│   └── database.ts
│       └── schema.ts
├── logger (referenced but cleaned)
├── scanner (referenced but cleaned)
└── cost-linker (referenced but cleaned)

router.tsx
├── DashboardPage.tsx
├── ActivityFeed.tsx
├── ActivityDetail.tsx
└── CostBreakdown.tsx
    └── types/activity.ts
```

---

## Recommendations

### Architecture Improvements

1. **Restore Missing Services**
   - Re-implement `session-log-scanner.ts` for exact cost tracking
   - Re-implement `cost-linker.ts` to link costs to activities
   - Re-implement `activity-logger.ts` for event emission

2. **Add API Client Abstraction**
   - Current direct fetch calls are simple but repetitive
   - Consider a lightweight API client with error handling
   - Add request/response interceptors for auth if needed

3. **Implement Proper Testing**
   - Unit tests for database operations
   - Integration tests for API endpoints
   - Frontend component tests with React Testing Library

4. **Add Authentication**
   - Currently no auth on API endpoints
   - Add API key or session-based auth
   - Protect sensitive cost data

### Tech Debt Areas

1. **ESLint Configuration**
   - Currently ignores `src/api/**` and `src/db/**`
   - These should be linted like the rest of the code
   - Fix the 21 lint errors by restoring/modifying services

2. **Type Safety**
   - Some `any` types in database.ts
   - Add strict typing for query results
   - Validate API responses with Zod

3. **Error Handling**
   - Inconsistent error handling across routes
   - Add centralized error middleware
   - Standardize error response format

4. **Missing Logger Implementation**
   - Server imports `ActivityLogger` but implementation missing
   - Currently falls back to database directly
   - Breaks SSE broadcasting chain

### Future Refactoring Opportunities

1. **Modularize API Routes**
   - Split `routes.ts` into separate route files
   - Group by domain: activities, sessions, costs
   - Add route-level middleware

2. **Database Migration System**
   - Current migrations.ts is basic
   - Consider using a proper migration tool
   - Add rollback capabilities

3. **Caching Layer**
   - Cache expensive aggregations (cost-report, stats)
   - Redis or in-memory cache for frequent queries
   - Cache invalidation on new activities

4. **Background Job Queue**
   - Move scanner to background worker
   - Queue for bulk operations
   - Retry failed scan attempts

5. **Frontend State Management**
   - Currently local state in each page
   - Consider React Query for server state
   - Centralize activity feed state

6. **Real-Time Enhancements**
   - WebSocket alternative to SSE for bidirectional
   - Subscription filtering (by session, actor)
   - Activity notifications

---

## Summary

Mission Control is a well-architected observability platform with:
- Clean separation between API, database, and frontend
- Real-time updates via SSE
- Comprehensive cost tracking capabilities
- Modern React frontend with shadcn/ui

**Current State:** Core functionality preserved after ORC-8 cleanup, but key services (scanner, linker, logger) need restoration for full cost tracking capabilities.

**Next Priority:**
1. Restore session-log-scanner.ts for exact cost extraction
2. Restore cost-linker.ts for cost attribution
3. Restore activity-logger.ts for proper event emission
4. Fix ESLint configuration to lint all source files
5. Add comprehensive test coverage
