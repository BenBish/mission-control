# Deployment Guide

How to run Mission Control locally and in the current Tailscale + systemd
topology. Paths and unit names match the repo under `deploy/`.

## Local development

### 1. Install dependencies

```bash
cd ~/Dev/mission-control   # or your clone path
bun install
```

### 2. Start the API

```bash
bun run api
```

- Listens on **`127.0.0.1:3001`** by default (`PORT`, `HOST` override).
- SQLite default: `./data/mission-control.db` (`DATABASE_PATH` override).
- Migrations run on startup via the database layer.

### 3. Start the frontend

```bash
bun run dev
```

- Vite on **http://localhost:3000**
- Proxies `/api` → `http://localhost:3001` (`VITE_API_PORT` if API uses another port)

### 4. Optional desktop collector

```bash
mkdir -p ~/.config/mission-control
cp deploy/collector.toml.example ~/.config/mission-control/collector.toml
# Edit server_url + api_key
bun run collector
```

For pure local API without Tailscale, set e.g.:

```toml
server_url = "http://127.0.0.1:3001"
api_key = "changeme"
```

and set the same `MC_API_KEY` in the server environment.

**Claude Code plan usage:** the `claude-code` collector reads
`~/.claude/.credentials.json` (OAuth access token already present when you use
Claude Code) and polls Anthropic’s OAuth usage endpoint every 5 minutes. Only
**percent utilization / resets_at** are sent to the server as `quota_snapshot`
events — never the access token. After provider credit sync, those rows appear
as Anthropic plan-usage windows on the Dashboard and Consumption.

### 5. Tests

```bash
bun test                 # unit + integration
bun run ci               # lint, prettier, typecheck, tests
bun run test:e2e         # Playwright (needs app setup per e2e config)
```

---

## Environment variables

Authoritative examples: `deploy/server.env.example` and
`deploy/collector.toml.example`.

### Server (common)

| Variable | Default / notes |
| --- | --- |
| `PORT` | `3001` |
| `HOST` | `127.0.0.1` (loopback; use Tailscale Serve for remote) |
| `DATABASE_PATH` | `./data/mission-control.db` |
| `NODE_ENV` | `development` / `production` |
| `MC_API_KEY` | Shared secret for `/api/ingest/*` |
| `MC_AUTH_ENABLED` | `false` — set `true` for JWT UI auth |
| `MC_PASSWORD_HASH` | bcrypt hash (required when auth enabled) |
| `MC_USERNAME` | owner username (default `admin`) |
| `MC_VIEWER_USERNAME` / `MC_VIEWER_PASSWORD_HASH` | optional read-only account |
| `MC_JWT_SECRET` | optional; random if unset |
| `MC_SESSION_TTL` | seconds (default 86400) |
| `MC_REQUIRE_AUTH_IN_PRODUCTION` | refuse start if prod + auth off |
| `MC_REDACTION_MODE` | `off` \| `standard` \| `strict` |
| `MC_RETENTION_*_DAYS` | per data class (see Architecture) |
| `MC_HERMES_POLLING_ENABLED` | `true` only on the box with llama-swap/journal access |
| `OPENROUTER_API_KEY`, `ANTHROPIC_ADMIN_KEY`, `OPENAI_ADMIN_KEY`, `XAI_API_KEY` | provider connectors |
| `MC_PROVIDER_SYNC_ENABLED` | scheduled billing sync |
| `MC_PROVIDER_SYNC_INTERVAL_MS` | default 3600000 (1h) |
| `MC_XAI_USAGE_ENDPOINT` | optional custom xAI usage JSON export |

Generate a password hash:

```bash
bun -e "console.log(await Bun.password.hash('yourpass'))"
```

### Frontend (dev)

| Variable | Notes |
| --- | --- |
| `VITE_PORT` | default `3000` |
| `VITE_API_PORT` | API port for Vite proxy (default `3001`) |

---

## Production-style host (systemd user unit)

### Server unit

Unit file: `deploy/mission-control.service`

1. Copy/link the unit into the user systemd directory (or point `WorkingDirectory`
   at your checkout).
2. Create env file (gitignored):

```bash
mkdir -p ~/.config/mission-control
cp deploy/server.env.example ~/.config/mission-control/server.env
# Set MC_API_KEY, auth, provider keys as needed
```

3. Ensure DB directory exists:

```bash
mkdir -p ~/.local/share/mission-control
```

The example unit sets:

- `DATABASE_PATH=%h/.local/share/mission-control/mc.db`
- `EnvironmentFile=-%h/.config/mission-control/server.env`
- `ExecStart=… bun run api`
- `WorkingDirectory=%h/Dev/mission-control` (adjust to your path)

```bash
systemctl --user daemon-reload
systemctl --user enable --now mission-control.service
systemctl --user status mission-control.service
```

### Desktop collector unit

Unit file: `deploy/mc-collector.service`

Requires `~/.config/mission-control/collector.toml` with `server_url` + `api_key`.

```bash
systemctl --user enable --now mc-collector.service
```

---

## Tailscale access

The server is intentionally **loopback-only** so it does not compete with
Tailscale’s bind and is not exposed on the LAN.

1. On the server host, expose the API (and optionally static UI served by the
   same process after `bun run build`):

```bash
# Example — exact flags depend on your Tailscale version / policy
tailscale serve --bg 3001
tailscale serve status
```

2. Desktop collectors use the **full MagicDNS HTTPS URL** as `server_url`, not
   a short hostname and not plain `http://` across the tailnet unless you
   intentionally configure that.

3. Browser users open the Tailscale URL (or local Vite in dev). With auth
   enabled, login uses `/api/auth/login`.

---

## Production frontend assets

```bash
bun run build
```

Vite writes to **`dist-vite/`** (not `dist/`). The Express SPA fallback serves
`dist-vite/index.html` for non-API paths. In a pure API-only process without a
build, the SPA fallback returns 404 JSON for unknown routes.

Note: `package.json` `bun start` → `node dist/index.js` is a separate compiled
server path; day-to-day production on this repo is typically `bun run api`
(Bun runs TypeScript directly) plus `dist-vite` static files.

---

## Docker

There is **no first-class Dockerfile** in this repository today. Prefer the
systemd + Tailscale model above. If you containerize:

- Run with Bun
- Mount a persistent volume for SQLite
- Pass `MC_API_KEY` / auth / provider env via secrets
- Keep the process on a private network and put TLS termination in front
- Point health checks at `GET /api/health`

Do not copy outdated sample Dockerfiles that assumed `package*.json` only or
`dist/` as the Vite output.

---

## Health & ops checks

```bash
curl -sS http://127.0.0.1:3001/api/health | jq .
```

Response includes `security.authEnabled`, redaction mode, and warnings when
production is unauthenticated.

Provider connector status:

```bash
curl -sS http://127.0.0.1:3001/api/providers/status | jq .
```

Manual provider sync (auth cookie or same-origin session as required):

```bash
curl -sS -X POST http://127.0.0.1:3001/api/providers/sync | jq .
```

---

## Retention behaviour

Retention runs on a timer inside the server process (see
`src/db/queries/retention.ts` + privacy policy). Defaults:

- Most event tables: **90 days**
- Raw `runtime_snapshots`: **7 days** (slots rolled up hourly first)

Operators can also call `POST /api/privacy/retention/run` (owner when auth is
on). See [ARCHITECTURE.md](./ARCHITECTURE.md#retention).

---

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `EADDRINUSE` on 3001 | Another `bun run api` or Tailscale already binding |
| Collector 401 on ingest | `api_key` ≠ `MC_API_KEY` |
| Empty agent data | Collector not running / wrong log paths / wrong machine |
| Empty Hermes runtime | `MC_HERMES_POLLING_ENABLED` false or not on the GPU box |
| UI loads but API fails in dev | API not running; Vite proxy expects port 3001 |
| Production UI blank | Forgot `bun run build` → missing `dist-vite/` |
