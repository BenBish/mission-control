# Mission Control Architecture

## Overview

Mission Control is a multi-source observability platform for AI agent and local
inference workloads. It collects session/activity telemetry from coding agents,
runtime metrics from local model servers, generation jobs from ComfyUI, and
account-level billing from cloud providers — then presents them in a React
dashboard with source-scoped filters and real-time SSE updates.

```
┌──────────────────────────┐     HTTP ingest      ┌─────────────────────────────┐
│ Desktop collectors       │ ───────────────────▶ │ Mission Control server      │
│ (Claude Code, Codex,     │   /api/ingest/*      │  Express · SQLite · auth    │
│  Grok, OpenCode)         │                      │  provider connectors        │
└──────────────────────────┘                      │  on-box pollers (optional)  │
                                                  │    Hermes / ComfyUI /       │
┌──────────────────────────┐   local poll         │    Lemonade                 │
│ On-server backends       │ ───────────────────▶ │                             │
│ (llama-swap, ComfyUI,    │                      │  GET /api/*  ·  SSE stream  │
│  Lemonade, …)            │                      └──────────────┬──────────────┘
└──────────────────────────┘                                     │
                                                                 ▼
                                                      Vite React dashboard
                                                      (dev :3000 / prod dist-vite)
```

### Design principles

1. **Sources, not profiles** — every row is scoped by `source_id` + `instance_id`.
2. **Separate authoritative datasets** — agent session costs and provider billing
   never sum into one opaque total (see [Cost & capacity data classes](#cost--capacity-data-classes)).
3. **Collectors push or poll** — desktop tools push over HTTP; local services poll
   on the machine that can reach them.
4. **Loopback + Tailscale** — server binds `127.0.0.1` by default; remote access
   is via `tailscale serve`, not open LAN binds.

---

## Core components

| Component | Path | Role |
| --- | --- | --- |
| API server | `src/server/server.ts` | Express app, auth middleware, schedulers |
| Routes | `src/server/routes/` | Domain route modules + SPA fallback |
| Auth | `src/server/auth.ts` | JWT cookies, API key for ingest, owner/viewer roles |
| Privacy | `src/server/privacy/` | Redaction + retention policy |
| Database | `src/db/` | Schema, migrations, query modules |
| Collectors | `src/collectors/` | Per-source ingestion logic |
| Desktop entry | `src/collector-main.ts` | Runs JSONL/SQLite collectors → HTTP sink |
| Provider connectors | `src/services/provider-connectors/` | OpenRouter / Anthropic / OpenAI / xAI billing |
| Frontend | `src/app/`, `src/pages/`, `src/components/` | React 19 + Router 7 + Tailwind v4 |

There is **no** `src/api/` tree. Older docs that referenced a single
`routes.ts` + OpenClaw-only bridge are obsolete.

---

## Data flow

1. **Desktop collectors** read local session logs / DBs and POST batches to
   `/api/ingest/batch` (authenticated with `MC_API_KEY`).
2. **On-server collectors** (when enabled) poll Hermes/ComfyUI/Lemonade and
   write through a local sink into the same SQLite DB.
3. **Provider sync** (optional interval or manual `POST /api/providers/sync`)
   pulls account usage/credits into `provider_*` tables.
4. **Retention** periodically prunes/redacts by data class.
5. **Dashboard** loads REST endpoints; **SSE** (`/api/stream`) invalidates caches
   for near-real-time UI updates.

---

## Collectors

| Collector | Kind | Where it runs | Input |
| --- | --- | --- | --- |
| Claude Code | agentic | Desktop (`collector`) | Session JSONL under `~/.claude` |
| Codex | agentic | Desktop | Codex session JSONL + quota signals |
| Grok | agentic | Desktop | `~/.grok/sessions/.../updates.jsonl` |
| OpenCode | agentic | Desktop | OpenCode SQLite (`opencode.db`) |
| Hermes | inference | Server (when `MC_HERMES_POLLING_ENABLED`) | llama-swap / llama-server / journal |
| Lemonade | inference | Server (when configured) | Local inference HTTP |
| ComfyUI | generation | Server (when configured) | ComfyUI queue/history API |

Shared collector core: `src/collectors/core/` (`scheduler`, `sinks`,
`state-store`, `jsonl-scanner`, types).

Desktop config: `~/.config/mission-control/collector.toml`  
(see `deploy/collector.toml.example`).

---

## Database

Schema: `src/db/schema.ts`. Runtime path:

- Dev default: `./data/mission-control.db` (`DATABASE_PATH` override)
- Production (systemd example): `~/.local/share/mission-control/mc.db`

### Registry

| Table | Purpose |
| --- | --- |
| `sources` | Logical source (kind: agentic / inference / generation / cloud-usage) |
| `source_instances` | Machine + endpoint + collector heartbeat status |

### Shape (a) — agentic sessions

| Table | Purpose |
| --- | --- |
| `sessions` | Session metadata, token totals, optional `cost_usd` |
| `activities` | Tool calls, messages, tokens, optional per-activity cost |

### Shape (b) — inference + runtime

| Table | Purpose |
| --- | --- |
| `inference_requests` | Per-request local model telemetry |
| `runtime_snapshots` | High-frequency slot/health/models samples |
| `runtime_slot_rollups` | Hourly rollups after raw retention |
| `runtime_events` | Discrete runtime incidents |
| `quota_snapshots` | Plan/rate-limit windows (Codex, Claude Code OAuth usage, …) |

### Shape (c) — generation

| Table | Purpose |
| --- | --- |
| `generation_jobs` | ComfyUI (and similar) job lifecycle |

### Background jobs

| Table | Purpose |
| --- | --- |
| `background_jobs` | Hermes/collector/scheduled job definitions |
| `job_runs` | Individual run history |

### Ingest + provider + budgets

| Table | Purpose |
| --- | --- |
| `ingest_dedupe` | Idempotent natural-key dedupe for ingest |
| `provider_usage_daily` | Provider **actual** daily spend/tokens |
| `provider_sync_status` | Connector health / last sync |
| `provider_credit_snapshots` | Wallet / prepaid / capacity remaining |
| `app_settings` | Key/value (legacy account budget, etc.) |
| `provider_spend_budgets` | Scoped monthly budgets |
| `spend_alert_events` | Threshold/anomaly alert state (`data_class`: cost / quota / wallet) |

Query modules live under `src/db/queries/`. Migrations: `src/db/migrations.ts`
(+ `migration-runner.ts`).

---

## Cost & capacity data classes

Mission Control keeps **five distinct data classes**. They must not be blindly
added together in the UI or APIs.

| Class | What it answers | Authoritative storage | Provenance |
| --- | --- | --- | --- |
| **1. Cost (actual billing)** | How much did the *provider account* charge? | `provider_usage_daily.cost_usd` | Provider Admin/usage APIs via connectors |
| **2. Usage (agent/session)** | How much did *agents* consume (tokens, requests)? | `activities` / `sessions` / `inference_requests` token fields | Collectors from session logs / local servers |
| **3. Quota (plan windows)** | How much of a *subscription rate limit* is used? | `quota_snapshots` (+ credit rows with unit `percent`/`requests`, surface `plan_usage`) | Session/tool telemetry: Codex windows + Claude Code OAuth usage endpoint via desktop collector; not USD |
| **4. Wallet (credits / balance)** | What prepaid capacity remains? | `provider_credit_snapshots` | Provider balance APIs or session-quota derived; **never** summed into spend |
| **5. Estimate (priced tokens)** | What would usage *cost* if priced from a table? | Session/activity `cost_usd` when log-supplied, else `src/types/pricing.ts` fallbacks | Session-log exact cost preferred; static/OpenRouter table is estimate-only |

### Non-double-counting contract

1. **Never** add agent session `cost_usd` into provider billing totals.
2. **Never** add wallet remaining into spend charts.
3. **Never** treat quota % as dollars.
4. OpenRouter + direct Anthropic/OpenAI/xAI can describe the *same* underlying
   calls (BYOK). Reconciliation flags overlap — see
   [spend-reconciliation.md](./spend-reconciliation.md).
5. Estimates from static pricing are labeled as estimates/provenance
   `session-log` or pricing-table — not as provider actuals.
6. Local/self-hosted models often have $0 cost; that is not “missing billing.”

UI surfaces (Consumption, Dashboard direct-API / Plan Usage cards, reconciliation)
keep these classes in **separate sections** rather than one combined “total spend.”
The Dashboard **Plan Usage** KPI shows only fresh (`status=ok`) percent-remaining
windows and never implies dollars.

Quota and wallet **capacity threshold alerts** reuse `spend_alert_events` with
`data_class` `quota` or `wallet` (never `cost`). They fire when a fresh plan-
usage window is at or below a remaining-% setting, or a fresh wallet is at or
below a remaining-$ setting. Stale/expired snapshots never alert. Thresholds
live in `app_settings` (`GET`/`PUT` `/api/providers/capacity-alert-settings`).

---

## Backend routes

Route registration: `src/server/routes/index.ts`.

| Area | Methods / paths |
| --- | --- |
| Health | `GET /api/health` |
| Auth | `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` |
| Ingest | `POST /api/ingest/batch`, `POST /api/ingest/heartbeat`, `GET /api/ingest/cursors` |
| Sources | `GET /api/sources` |
| Sessions | `GET /api/sessions`, `GET /api/sessions/:id` |
| Activities | `GET /api/activities`, `GET /api/activities/:id` |
| Consumption | `GET /api/consumption`, `…/agent-usage`, `…/agent-usage/sessions`, `…/reconciliation` |
| Failures | `GET /api/failures`, `…/groups`, `…/groups/:fingerprint/events` |
| Jobs | `GET /api/jobs`, `…/:id`, `…/:id/runs` |
| Runtime | `GET /api/runtime` |
| Contention | `GET /api/contention` |
| Generations | `GET /api/generations`, `…/:id` |
| Providers | status, sync, usage, breakdown, budget(s), spend-insights, spend-alerts, capacity-alert-settings, credits |
| Privacy | `GET /api/privacy/policy`, retention run, purge-sensitive |
| Stream | `GET /api/stream` (SSE) |

Full request/response notes: [API_SPECIFICATION.md](./API_SPECIFICATION.md).

### SSE

`GET /api/stream` keeps long-lived connections and heartbeats. The frontend
(`useSSE`, dashboard invalidation helpers) refreshes React Query caches when
events arrive.

---

## Frontend

| Route | Page |
| --- | --- |
| `/` | Dashboard |
| `/activities`, `/activities/:id` | Activity feed + detail |
| `/sessions`, `/sessions/:id` | Sessions + timeline |
| `/runtime` | Local inference runtime |
| `/failures` | Failure analysis |
| `/consumption` | Spend, agent usage, reconciliation |
| `/jobs`, `/jobs/:jobId` | Background jobs (workload-gated) |
| `/generations`, `/generations/:generationId` | Image generations (workload-gated) |
| `/settings` | Settings / health / budgets |

Router: `src/app/router.tsx`. Layout + nav: `src/components/_shared/MainLayout.tsx`.
Source filter: global `SourceFilter` + `source-context`.

### Skills Registry (removed)

An unfinished Skills Registry UI (`src/app/skills/**`, `src/types/skills.ts`)
existed without routes, navigation, or a backend `/api/skills` API. It was
**removed** in BSH-104 as orphaned code rather than productized. Agent skills
are not currently a Mission Control domain.

---

## Auth & privacy

### Auth

- Off by default in development (`MC_AUTH_ENABLED=false`).
- When enabled: owner + optional viewer (read-only), JWT in `mc_session` cookie.
- Collectors use `MC_API_KEY` on ingest routes (bypass JWT).
- Production can refuse start without auth via `MC_REQUIRE_AUTH_IN_PRODUCTION`.

See `src/server/auth.ts` and `deploy/server.env.example`.

### Redaction

`MC_REDACTION_MODE`: `off` | `standard` (default) | `strict` — secrets/paths,
optional prompt redaction, tool payload truncation (`src/server/privacy/`).

### Retention

| Data class | Default days | Env |
| --- | --- | --- |
| activities | 90 | `MC_RETENTION_ACTIVITIES_DAYS` |
| sessions | 90 | `MC_RETENTION_SESSIONS_DAYS` |
| inference | 90 | `MC_RETENTION_INFERENCE_DAYS` |
| runtime (raw snapshots) | 7 | `MC_RETENTION_RUNTIME_DAYS` |
| generations | 90 | `MC_RETENTION_GENERATIONS_DAYS` |
| jobs | 90 | `MC_RETENTION_JOBS_DAYS` |

Runtime **slots** rows older than the window are rolled into
`runtime_slot_rollups` before delete. `quota_snapshots` (including Claude
Code usage-poller rows) prune on the inference window. Owner can trigger
`POST /api/privacy/retention/run` and `POST /api/privacy/purge-sensitive`.

---

## Deployment topology

Typical production shape:

1. **Server host** (e.g. Fedora) runs `bun run api` via
   `deploy/mission-control.service`, SQLite on disk, optional Hermes/Comfy
   pollers.
2. **Tailscale Serve** terminates TLS and proxies to `127.0.0.1:3001`.
3. **Desktop host** runs `bun run collector` / `mc-collector.service` with
   `server_url` pointing at the MagicDNS HTTPS endpoint and matching `api_key`.

Details: [DEPLOYMENT.md](./DEPLOYMENT.md).

---

## Provider connectors

Code: `src/services/provider-connectors/`.

| Provider | Credential env | Notes |
| --- | --- | --- |
| OpenRouter | `OPENROUTER_API_KEY` | Activity/usage; BYOK may overlap direct providers |
| Anthropic | `ANTHROPIC_ADMIN_KEY` | Admin usage/cost; balance often unavailable |
| OpenAI | `OPENAI_ADMIN_KEY` | Org usage/costs; optional credit grants |
| xAI | `XAI_API_KEY` | Limited public usage history; optional custom export |

`MC_PROVIDER_SYNC_ENABLED=true` schedules sync (interval
`MC_PROVIDER_SYNC_INTERVAL_MS`, default 1h). Manual: `POST /api/providers/sync`.

---

## Documentation freshness checklist

When a change touches architecture, routes, schema, collectors, auth, or
deployment, update the matching docs in the same PR:

- [ ] **README.md** — scripts, ports, structure, links still valid
- [ ] **docs/ARCHITECTURE.md** — diagrams, tables, data classes, routes
- [ ] **docs/API_SPECIFICATION.md** — added/removed/changed endpoints
- [ ] **docs/DEPLOYMENT.md** — env vars, systemd, Tailscale, paths
- [ ] **docs/spend-reconciliation.md** — if matching/BYOK rules change
- [ ] **CLAUDE.md** / **CONTRIBUTING.md** — if contributor workflow changes
- [ ] No links to deleted paths (`src/api/`, `docs/SKILLS.md`, Skills UI, etc.)
- [ ] Cost UI copy still matches the five data classes / non-double-counting rules

---

## Related docs

- [API_SPECIFICATION.md](./API_SPECIFICATION.md)
- [DEPLOYMENT.md](./DEPLOYMENT.md)
- [spend-reconciliation.md](./spend-reconciliation.md)
- [provider-capacity-research.md](./provider-capacity-research.md)
