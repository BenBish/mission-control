# API Specification

Complete REST API documentation for Mission Control Activity Feed.

## Base URL

```
http://localhost:3001/api
```

## Authentication

Currently no authentication (local MVP). Authentication will be added in Phase 2.

## Response Format

All endpoints return JSON responses:

```typescript
{
  success: boolean;
  data?: T;
  error?: string;
}
```

## Error Handling

HTTP status codes:

- `200` - OK
- `400` - Bad request (invalid parameters)
- `404` - Not found (resource doesn't exist)
- `500` - Server error

Error response:

```json
{
  "success": false,
  "error": "Human-readable error message"
}
```

---

## Activities Endpoints

### GET /activities

Get activities with optional filtering and pagination.

**Query Parameters:**

- `sessionId` (string, optional) - Filter by session ID
- `actorId` (string, optional) - Filter by actor ID
- `actorType` (string, optional) - Filter by actor type: `orchestrator`, `subagent`, `user`, `system`
- `actionType` (string, optional) - Filter by action type: `tool_call`, `delegation`, `api_call`, etc.
- `toolName` (string, optional) - Filter by tool name (e.g., `exec`, `read`, `web_search`)
- `status` (string, optional) - Filter by status: `pending`, `success`, `failure`, `partial`
- `startTime` (ISO8601 string, optional) - Filter by start time (inclusive)
- `endTime` (ISO8601 string, optional) - Filter by end time (inclusive)
- `limit` (integer, optional, default: 100) - Max results per page
- `offset` (integer, optional, default: 0) - Pagination offset

**Example Request:**

```bash
curl "http://localhost:3001/api/activities?sessionId=agent:main&status=success&limit=50"
```

**Response:**

```json
{
  "success": true,
  "count": 42,
  "activities": [
    {
      "id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      "sessionId": "agent:main",
      "timestamp": "2026-02-15T13:39:22.123Z",
      "actor": {
        "type": "subagent",
        "id": "agent:main:subagent:abc123",
        "role": "Engineer"
      },
      "actionType": "tool_call",
      "toolName": "exec",
      "description": "Executed shell command: git status",
      "status": "success",
      "durationMs": 150,
      "tokens": {
        "inputTokens": 124,
        "outputTokens": 80,
        "totalTokens": 204,
        "model": "openrouter/anthropic/claude-haiku-4.5"
      },
      "cost": {
        "usd": 0.000816
      }
    }
    // ... more activities
  ]
}
```

---

### GET /activities/:id

Get a specific activity by ID.

**Path Parameters:**

- `id` (string, required) - Activity ID (UUID v7)

**Example Request:**

```bash
curl "http://localhost:3001/api/activities/01ARZ3NDEKTSV4RRFFQ69G5FAV"
```

**Response:**

```json
{
  "success": true,
  "activity": {
    "id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    "sessionId": "agent:main"
    // ... full activity object
  }
}
```

**Error Response (404):**

```json
{
  "success": false,
  "error": "Activity not found"
}
```

---

### GET /activities/search

Search activities by description or details.

**Query Parameters:**

- `q` (string, required) - Search query string (case-insensitive)

**Example Request:**

```bash
curl "http://localhost:3001/api/activities/search?q=git+status"
```

**Response:**

```json
{
  "success": true,
  "count": 5,
  "activities": [
    // Activities matching the query
  ]
}
```

---

## Sessions Endpoints

### GET /sessions/:id

Get session summary with aggregated statistics.

**Path Parameters:**

- `id` (string, required) - Session ID

**Example Request:**

```bash
curl "http://localhost:3001/api/sessions/agent:main"
```

**Response:**

```json
{
  "success": true,
  "summary": {
    "sessionId": "agent:main",
    "startTime": "2026-02-15T13:00:00.000Z",
    "endTime": "2026-02-15T13:45:00.000Z",
    "stats": {
      "totalActions": 42,
      "successCount": 40,
      "failureCount": 2,
      "successRate": 95.24,
      "totalTokens": 8420,
      "totalCost": 0.0234,
      "avgActionDuration": 245
    },
    "actors": {
      "agent:main:main": {
        "name": "agent:main:main",
        "actionsCount": 15,
        "successCount": 14,
        "tokensUsed": 4200,
        "costUsd": 0.0125
      },
      "agent:main:subagent:abc123": {
        "name": "agent:main:subagent:abc123",
        "actionsCount": 27,
        "successCount": 26,
        "tokensUsed": 4220,
        "costUsd": 0.0109
      }
    },
    "topTools": [
      {
        "name": "exec",
        "count": 12,
        "cost": 0.005
      },
      {
        "name": "web_search",
        "count": 8,
        "cost": 0.0082
      },
      {
        "name": "read",
        "count": 15,
        "cost": 0.0042
      }
    ],
    "events": []
  }
}
```

---

### GET /sessions/:id/activities

Get all activities for a specific session.

**Path Parameters:**

- `id` (string, required) - Session ID

**Example Request:**

```bash
curl "http://localhost:3001/api/sessions/agent:main/activities"
```

**Response:**

```json
{
  "success": true,
  "count": 42,
  "activities": [
    // Array of Activity objects
  ]
}
```

---

### GET /sessions/:id/cost-report

Get detailed cost breakdown for a session.

**Path Parameters:**

- `id` (string, required) - Session ID

**Example Request:**

```bash
curl "http://localhost:3001/api/sessions/agent:main/cost-report"
```

**Response:**

```json
{
  "success": true,
  "sessionId": "agent:main",
  "totalCost": 0.0234,
  "totalTokens": 8420,
  "actors": {
    "agent:main:main": {
      "name": "agent:main:main",
      "actionsCount": 15,
      "successCount": 14,
      "tokensUsed": 4200,
      "costUsd": 0.0125
    },
    "agent:main:subagent:abc123": {
      "name": "agent:main:subagent:abc123",
      "actionsCount": 27,
      "successCount": 26,
      "tokensUsed": 4220,
      "costUsd": 0.0109
    }
  },
  "topTools": [
    {
      "name": "exec",
      "count": 12,
      "cost": 0.005
    },
    {
      "name": "web_search",
      "count": 8,
      "cost": 0.0082
    }
  ]
}
```

---

## Reporting Endpoints

### GET /cost-report

Get overall cost aggregation across all sessions.

**Example Request:**

```bash
curl "http://localhost:3001/api/cost-report"
```

**Response:**

```json
{
  "success": true,
  "totalCost": 1.2345,
  "totalTokens": 154320,
  "activityCount": 1204,
  "actorCosts": {
    "agent:main:main": {
      "cost": 0.5234,
      "tokens": 75420,
      "actions": 450
    },
    "agent:main:subagent:abc123": {
      "cost": 0.3891,
      "tokens": 54230,
      "actions": 380
    },
    "ben": {
      "cost": 0.322,
      "tokens": 24670,
      "actions": 374
    }
  },
  "toolCosts": {
    "exec": {
      "cost": 0.0845,
      "count": 345
    },
    "web_search": {
      "cost": 0.324,
      "count": 128
    },
    "read": {
      "cost": 0.0234,
      "count": 456
    },
    "write": {
      "cost": 0.0156,
      "count": 89
    }
  }
}
```

---

### GET /stats

Get overall system statistics.

**Example Request:**

```bash
curl "http://localhost:3001/api/stats"
```

**Response:**

```json
{
  "success": true,
  "stats": {
    "activities": 1204,
    "sessions": 8,
    "successCount": 1152,
    "failureCount": 52,
    "successRate": 95.68,
    "totalCost": 1.2345,
    "totalTokens": 154320
  }
}
```

---

## Diagnostic Endpoints

### GET /health

Health check endpoint. Always responds with status 200.

**Example Request:**

```bash
curl "http://localhost:3001/api/health"
```

**Response:**

```json
{
  "success": true,
  "status": "healthy",
  "timestamp": "2026-02-15T13:39:22.123Z"
}
```

---

### GET /pending-activities

Get all activities currently in progress (pending status).

**Example Request:**

```bash
curl "http://localhost:3001/api/pending-activities"
```

**Response:**

```json
{
  "success": true,
  "count": 3,
  "activities": [
    {
      "id": "01ARZ3NDEKTSV4RRYY5G5FAV",
      "sessionId": "agent:main",
      "timestamp": "2026-02-15T13:39:00.000Z",
      "actor": {
        "type": "subagent",
        "id": "agent:main:subagent:abc123"
      },
      "actionType": "tool_call",
      "toolName": "web_search",
      "description": "Searching for documentation",
      "status": "pending"
    }
    // ... more pending activities
  ]
}
```

---

## Rate Limiting

Currently no rate limiting (Phase 2).

## Pagination

Large result sets can be paginated using `limit` and `offset`:

```bash
# Get first 50 results
curl "http://localhost:3001/api/activities?limit=50&offset=0"

# Get next 50
curl "http://localhost:3001/api/activities?limit=50&offset=50"
```

## Filtering Strategies

### By Session and Status

```bash
curl "http://localhost:3001/api/activities?sessionId=agent:main&status=failure"
```

### By Time Range

```bash
curl "http://localhost:3001/api/activities?startTime=2026-02-15T13:00:00Z&endTime=2026-02-15T14:00:00Z"
```

### By Tool

```bash
curl "http://localhost:3001/api/activities?toolName=exec"
```

### By Actor

```bash
curl "http://localhost:3001/api/activities?actorId=agent:main:subagent:abc123"
```

## Examples

### Get all failed activities in current session

```bash
curl "http://localhost:3001/api/activities?sessionId=agent:main&status=failure"
```

### Get total cost for engineer subagent

```bash
curl "http://localhost:3001/api/sessions/agent:main/cost-report" | jq '.actors[] | select(.name | contains("engineer"))'
```

### Find all web_search activities from last hour

```bash
curl "http://localhost:3001/api/activities?toolName=web_search&startTime=$(date -u -d '-1 hour' +%Y-%m-%dT%H:%M:%SZ)"
```

### Track costs by tool

```bash
curl "http://localhost:3001/api/cost-report" | jq '.toolCosts | sort_by(.cost) | reverse'
```

---

## Future Endpoints (Phase 2+)

- `POST /activities/:id/tags` - Add tags to activity
- `DELETE /activities/:id` - Delete activity (admin only)
- `GET /export/csv` - Export activities to CSV
- `POST /webhooks` - Register webhooks for activity events
- `WS /stream` - WebSocket for real-time updates
- `POST /batch-import` - Bulk import activities

---

**Status:** Complete for Phase 1 MVP
