# Deployment Guide

Instructions for deploying Mission Control Activity Feed locally and to production.

## Local Development

### Quick Start

1. **Install dependencies:**

   ```bash
   cd ~/Dev/openclaw-mission-control
   bun install
   ```

2. **Initialize database:**

   ```bash
   bun run db:migrate
   ```

3. **Start the API server:**

   ```bash
   bun run api
   ```

   Server will start at `http://localhost:3001`

4. **Run tests:**
   ```bash
   bun test
   ```

### Development Workflow

```bash
# In one terminal - run API server with auto-reload
bun run api

# In another terminal - run tests in watch mode
bun test:watch

# In third terminal - run example
node --loader ts-node/esm examples/basic-usage.ts
```

## Docker Deployment

### Build Docker Image

Create `Dockerfile`:

```dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN bun install --only=production

# Copy source and build
COPY . .
RUN bun run build

# Create data directory
RUN mkdir -p /app/data

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/api/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Start server
CMD ["bun", "start"]
```

Build and run:

```bash
# Build image
docker build -t mission-control-activity-feed:0.1.0 .

# Run container
docker run -p 3001:3001 \
  -v $(pwd)/data:/app/data \
  -e NODE_ENV=production \
  mission-control-activity-feed:0.1.0
```

### Docker Compose

Create `docker-compose.yml`:

```yaml
version: "3.8"

services:
  activity-feed:
    build: .
    ports:
      - "3001:3001"
    environment:
      NODE_ENV: production
      PORT: 3001
      DATABASE_PATH: /app/data/mission-control.db
      ARCHIVE_PATH: /app/data/archives
    volumes:
      - ./data:/app/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/api/health"]
      interval: 30s
      timeout: 3s
      retries: 3
```

Run with Docker Compose:

```bash
docker-compose up -d
```

## Systemd Service (Linux)

Create `/etc/systemd/system/mission-control-activity-feed.service`:

```ini
[Unit]
Description=Mission Control Activity Feed
After=network.target

[Service]
Type=simple
User=ben
WorkingDirectory=/home/ben/Dev/openclaw-mission-control
ExecStart=/usr/bin/bun start
Restart=always
RestartSec=10

Environment="NODE_ENV=production"
Environment="PORT=3001"
Environment="DATABASE_PATH=/home/ben/Dev/openclaw-mission-control/data/mission-control.db"

StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable mission-control-activity-feed
sudo systemctl start mission-control-activity-feed

# Check status
sudo systemctl status mission-control-activity-feed

# View logs
sudo journalctl -u mission-control-activity-feed -f
```

## Environment Configuration

### Production Settings

```bash
# .env.production
NODE_ENV=production
PORT=3001
DATABASE_PATH=/data/mission-control.db
ARCHIVE_PATH=/data/archives

LOG_LEVEL=warn
CAPTURE_OUTPUT=true
MAX_OUTPUT_SIZE=5000

ENABLE_COST_TRACKING=true

RETENTION_HOT_DAYS=7
RETENTION_WARM_DAYS=90

# Provider billing connectors (optional — account-level usage/cost APIs)
# Distinct from session-log cost tracking. See deploy/server.env.example.
# OPENROUTER_API_KEY=
# ANTHROPIC_ADMIN_KEY=
# OPENAI_ADMIN_KEY=
# XAI_API_KEY=
# MC_XAI_USAGE_ENDPOINT=
# MC_PROVIDER_SYNC_ENABLED=false
# MC_PROVIDER_SYNC_INTERVAL_MS=3600000
```

### Provider API cost connectors

Configure only the providers you use. Missing keys leave that connector in `not_configured` (no errors, no crash).

| Env | Purpose |
| --- | --- |
| `OPENROUTER_API_KEY` | OpenRouter activity/usage (management key preferred) |
| `ANTHROPIC_ADMIN_KEY` | Anthropic Admin Usage & Cost API |
| `OPENAI_ADMIN_KEY` | OpenAI organization Admin usage/costs |
| `XAI_API_KEY` | xAI key verification; historical usage needs `MC_XAI_USAGE_ENDPOINT` |
| `MC_PROVIDER_SYNC_ENABLED` | `true` to poll on interval (default off) |
| `MC_PROVIDER_SYNC_INTERVAL_MS` | Poll interval (default 3600000) |

Trigger a one-shot sync: `POST /api/providers/sync`. View status: `GET /api/providers/status`. UI: Consumption → **Provider API costs**.

**Security:** `POST /api/providers/sync` triggers outbound calls with admin/provider keys and can consume provider rate limits. If the API is reachable beyond loopback/tailnet, enable `MC_AUTH_ENABLED=true` (or keep the service strictly private). Never commit real keys. Status responses never include secret values.

**Accuracy notes:** OpenAI cost `line_item` labels may not match completion `model` ids exactly (MC attempts simple normalization). OpenRouter BYOK spend can also appear under a direct Anthropic/OpenAI connector if both are configured.

### Security Hardening

1. **Database encryption** (SQLite):
   - Use SQLCipher for encrypted database
   - Set strong encryption password via environment variable

2. **API access control** (Phase 2):
   - Add JWT authentication
   - Implement API key management
   - Add role-based access control

3. **Data redaction**:
   - Auto-redact sensitive patterns in activity logs
   - Implement before storage

```typescript
// Example redaction
const redact = (text: string): string => {
  return text
    .replace(/([A-Za-z0-9+/]{40,})/g, "[REDACTED_KEY]")
    .replace(/password\s*[:=]\s*\S+/gi, "password=[REDACTED]")
    .replace(/api[_-]?key\s*[:=]\s*\S+/gi, "api_key=[REDACTED]")
    .replace(/token\s*[:=]\s*\S+/gi, "token=[REDACTED]");
};
```

## Scaling for Production

### Database Upgrade Path

For high-volume scenarios (>1000 activities/day):

1. **Phase 1 (Current):** SQLite
2. **Phase 2:** PostgreSQL with TimescaleDB
3. **Phase 3:** PostgreSQL + Elasticsearch + Kafka

### Horizontal Scaling

```yaml
# docker-compose.yml with multiple instances + reverse proxy

version: "3.8"

services:
  nginx:
    image: nginx:latest
    ports:
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
    depends_on:
      - activity-feed-1
      - activity-feed-2

  activity-feed-1:
    build: .
    environment:
      PORT: 3001
      DATABASE_PATH: /data/mission-control.db
    volumes:
      - ./data:/data

  activity-feed-2:
    build: .
    environment:
      PORT: 3002
      DATABASE_PATH: /data/mission-control.db
    volumes:
      - ./data:/data
```

## Monitoring

### Health Checks

```bash
# Check API health
curl http://localhost:3001/api/health

# Get system stats
curl http://localhost:3001/api/stats

# Monitor database size
du -sh ~/Dev/openclaw-mission-control/data/mission-control.db
```

### Logging Setup

Enable request logging in Express:

```typescript
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.path} ${res.statusCode} ${duration}ms`,
    );
  });
  next();
});
```

Aggregate logs with ELK stack (Phase 2):

```yaml
services:
  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:latest
    environment:
      - discovery.type=single-node

  kibana:
    image: docker.elastic.co/kibana/kibana:latest
    ports:
      - "5601:5601"

  filebeat:
    image: docker.elastic.co/beats/filebeat:latest
    volumes:
      - /var/log/mission-control:/logs
      - ./filebeat.yml:/usr/share/filebeat/filebeat.yml
```

## Backup Strategy

### Database Backup

```bash
# Manual backup
cp ~/Dev/openclaw-mission-control/data/mission-control.db \
   ~/Dev/openclaw-mission-control/data/mission-control.db.backup.$(date +%Y%m%d_%H%M%S)

# Automated backup with cron
0 2 * * * cp ~/Dev/openclaw-mission-control/data/mission-control.db \
           ~/Dev/openclaw-mission-control/data/backups/mission-control.db.$(date +\%Y\%m\%d)
```

### Archive Cleanup

```bash
# Delete archives older than 90 days
find ~/Dev/openclaw-mission-control/data/archives -name "*.gz" -mtime +90 -delete

# Or in cron
0 3 * * 0 find ~/Dev/openclaw-mission-control/data/archives -name "*.gz" -mtime +90 -delete
```

## Upgrading

### From v0.1.0 to v0.2.0+

1. **Backup current database:**

   ```bash
   cp data/mission-control.db data/mission-control.db.v0.1.0
   ```

2. **Pull latest code:**

   ```bash
   git pull origin main
   ```

3. **Install dependencies:**

   ```bash
   bun install
   ```

4. **Run migrations:**

   ```bash
   bun run db:migrate
   ```

5. **Restart service:**
   ```bash
   systemctl restart mission-control-activity-feed
   ```

## Troubleshooting

### Port Already in Use

```bash
# Find process using port 3001
lsof -i :3001

# Kill process
kill -9 <PID>
```

### Database Locked

SQLite may lock if multiple processes access it. Solutions:

1. Use single instance only
2. Upgrade to PostgreSQL (Phase 2)
3. Increase timeout: `PRAGMA busy_timeout = 5000;`

### Out of Memory

Monitor database growth:

```bash
du -sh data/mission-control.db

# If too large, implement archival:
# - Move old activities to gzipped JSON
# - Summarize to cost_summaries table
```

### Slow Queries

Add indexes for common filters:

```sql
-- Already included in schema, but for reference:
CREATE INDEX IF NOT EXISTS idx_activities_session_actor
ON activities(session_id, actor_id);

CREATE INDEX IF NOT EXISTS idx_activities_timestamp
ON activities(timestamp DESC);
```

## Performance Tuning

### SQLite Optimizations

```typescript
// Already configured in schema.ts with:
PRAGMA journal_mode=WAL;      // Write-ahead logging for concurrency
PRAGMA synchronous=NORMAL;     // Balanced safety and speed

// For high volume, add:
PRAGMA cache_size=10000;       // Increase cache
PRAGMA temp_store=MEMORY;      // Use memory for temp
```

### API Response Caching

```typescript
// Cache expensive queries
const cache = new Map();
const CACHE_TTL = 60000; // 1 minute

async function getCachedSummary(sessionId) {
  const cached = cache.get(sessionId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  const data = await logger.getSessionSummary(sessionId);
  cache.set(sessionId, { data, timestamp: Date.now() });
  return data;
}
```

## Compliance & Retention

### Data Deletion

Implement automatic cleanup based on retention policy:

```typescript
async function pruneOldActivities() {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 90); // 90 days

  await db.deleteActivitiesBefore(cutoffDate);
}

// Run daily
schedule.scheduleJob("0 3 * * *", pruneOldActivities);
```

### Audit Logging

Track who accessed what:

```typescript
app.use((req, res, next) => {
  auditLog({
    timestamp: new Date(),
    user: req.user?.id,
    action: req.method,
    resource: req.path,
    status: res.statusCode,
  });
  next();
});
```

---

**Status:** Deployment guide for Phase 1 MVP
