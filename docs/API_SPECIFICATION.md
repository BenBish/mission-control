# API Specification

REST + SSE surface for Mission Control. Base URL (local):

```
http://127.0.0.1:3001/api
```

In Vite dev, the browser calls same-origin `/api/*` and the proxy forwards to
the API. Route modules live under `src/server/routes/`; auth under
`src/server/auth.ts`.

This document is a **current-shape overview**. Prefer reading the route files
for exact query parameters and response fields when implementing clients.

## Authentication

| Mode | How |
| --- | --- |
| Auth disabled (`MC_AUTH_ENABLED` ≠ `true`) | All routes open (local single-user default) |
| Auth enabled | Browser: JWT in HttpOnly cookie `mc_session` via `POST /api/auth/login` |
| Collectors | Header / config `MC_API_KEY` for ingest routes |
| Roles | `owner` (full) · `viewer` (read-only; sensitive detail restricted) |

### Auth endpoints

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/api/auth/login` | username + password → sets session cookie |
| `POST` | `/api/auth/logout` | clears cookie |
| `GET` | `/api/auth/me` | current user or unauthenticated |

## Common response shape

Many endpoints return:

```json
{ "success": true, "...": "payload fields" }
```

Errors commonly:

```json
{ "success": false, "error": "Human-readable message" }
```

HTTP status codes: `200`, `400`, `401`, `403`, `404`, `500` as appropriate.

---

## Health

### `GET /api/health`

Liveness + security posture (no secrets):

- `status`, `timestamp`
- `security.authEnabled`, `redactionMode`, `unsafeUnauthenticated`, optional `warning`

---

## Ingest (collectors)

Authenticated with API key when configured.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/ingest/batch` | Upsert sessions/activities/etc. batch |
| `POST` | `/api/ingest/heartbeat` | Source instance heartbeat / status |
| `GET` | `/api/ingest/cursors` | Collector cursor helpers |

---

## Sources

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/sources` | Sources + instances (for filter + health) |

---

## Sessions & activities

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/sessions` | List sessions (filters: source, time, …) |
| `GET` | `/api/sessions/:id` | Session detail |
| `GET` | `/api/activities` | List activities |
| `GET` | `/api/activities/:id` | Activity detail |

---

## Consumption & agent usage

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/consumption` | Consumption rollup for the UI |
| `GET` | `/api/consumption/agent-usage` | Normalized agent usage dimensions |
| `GET` | `/api/consumption/agent-usage/export` | CSV/JSON download of ranked agent-usage drivers (`format=csv\|json`; same filters as agent-usage) |
| `GET` | `/api/consumption/agent-usage/sessions` | Session breakdown for agent usage |
| `GET` | `/api/consumption/reconciliation` | Provider vs agent linking (see spend-reconciliation.md) |

**Contract:** agent usage and provider billing are separate. Do not sum raw
totals client-side without reading reconciliation classifications.

---

## Failures

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/failures` | Recent failure events |
| `GET` | `/api/failures/groups` | Grouped by fingerprint |
| `GET` | `/api/failures/groups/:fingerprint/events` | Events in a group |

---

## Jobs (background)

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/jobs` | List background jobs |
| `GET` | `/api/jobs/:id` | Job detail |
| `GET` | `/api/jobs/:id/runs` | Run history |

---

## Runtime & contention

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/runtime` | Slots, models, health, recent inference |
| `GET` | `/api/contention` | Contention incidents |

---

## Generations

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/generations` | ComfyUI (etc.) generation jobs |
| `GET` | `/api/generations/:id` | Generation detail |

---

## Providers (billing / capacity)

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/providers/status` | Connector config/sync status |
| `POST` | `/api/providers/sync` | Trigger sync now |
| `GET` | `/api/providers/usage` | Daily usage rows |
| `GET` | `/api/providers/usage/export` | CSV/JSON download of daily usage (`format=csv\|json`; same filters as usage) |
| `GET` | `/api/providers/usage/breakdown` | Breakdown by model/provider |
| `GET` | `/api/providers/credits` | Wallet / credit snapshots (+ persist quota/wallet capacity alerts) |
| `GET` / `PUT` | `/api/providers/budget` | Legacy account monthly budget |
| `GET` / `PUT` | `/api/providers/budgets` | Scoped budgets |
| `DELETE` | `/api/providers/budgets/:id` | Delete scoped budget |
| `GET` / `PUT` | `/api/providers/capacity-alert-settings` | Plan-usage remaining-% and wallet remaining-$ thresholds |
| `GET` | `/api/providers/spend-insights` | Burn rate / insights |
| `GET` | `/api/providers/spend-alerts` | Alert events (`?dataClass=cost\|quota\|wallet`) |
| `PATCH` | `/api/providers/spend-alerts/:id` | Ack/suppress delivery state |

Credentials and env: see Deployment + Architecture. **Credits are not spend.**

---

## Privacy

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/privacy/policy` | Effective redaction + retention |
| `POST` | `/api/privacy/retention/run` | Run retention now (owner) |
| `POST` | `/api/privacy/purge-sensitive` | One-shot scrub of sensitive fields |

---

## SSE

### `GET /api/stream`

Server-Sent Events stream for live dashboard invalidation.

- `Content-Type: text/event-stream`
- Periodic heartbeats
- Clients should reconnect on drop

---

## SPA fallback

Non-`/api` GETs attempt to serve `dist-vite/index.html` for client-side routing
after a production build. Unknown `/api/*` paths return JSON 404.

---

## Not present

- **No `/api/skills`** — Skills Registry UI was removed (BSH-104).
- **No monolithic `src/api/routes.ts`** — routes are modular under `src/server/routes/`.
- **No public unauthenticated write API** for UI mutations when auth is enabled
  (viewer role is read-only).

## Related

- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [spend-reconciliation.md](./spend-reconciliation.md)
- [DEPLOYMENT.md](./DEPLOYMENT.md)
