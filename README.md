# Mission Control

Activity monitoring dashboard for multi-source AI agent systems. Tracks sessions,
activities, local inference runtime, image generations, provider billing, and
source health across Claude Code, Codex, Grok, OpenCode, Hermes, Lemonade, and
ComfyUI.

**Stack:** React 19 + Vite + Tailwind CSS v4 frontend · Express REST API · SQLite · Bun

## Prerequisites

- [Bun](https://bun.sh) 1.0+

```bash
curl -fsSL https://bun.sh/install | bash
```

## Quick start

```bash
bun install

# Terminal 1 — API + SQLite (port 3001, loopback by default)
bun run api

# Terminal 2 — Vite dev server (port 3000, proxies /api → 3001)
bun run dev
```

Open **http://localhost:3000**.

Optional desktop collector (JSONL / local tool telemetry → server ingest):

```bash
# Copy and edit config first
cp deploy/collector.toml.example ~/.config/mission-control/collector.toml
bun run collector
```

## Scripts

| Script | Description |
| --- | --- |
| `bun run dev` | Vite dev server (port **3000**, `/api` proxy → API) |
| `bun run api` | Express API + optional on-server collectors (port **3001**) |
| `bun run collector` | Desktop collector (Claude Code, Codex, Grok, OpenCode) |
| `bun run build` | Typecheck + Vite production build → **`dist-vite/`** |
| `bun run preview` | Preview production build (port 4173) |
| `bun run lint` | ESLint |
| `bun run format:check` | Prettier check |
| `bun test` | Unit / integration tests (Bun) |
| `bun run test:e2e` | Playwright e2e |
| `bun run ci` | lint + prettier + typecheck + unit tests |
| `bun run db:migrate` | Run DB migrations |
| `bun start` | Node entry for a compiled server bundle (`dist/index.js`) if present |

## Build output

| Output | Purpose |
| --- | --- |
| `dist-vite/` | Frontend production assets (Vite `outDir`). Served by the API SPA fallback. |
| `data/` | Default SQLite location in dev (`./data/mission-control.db`); often a symlink to `~/.local/share/mission-control` |

There is no `docs/SKILLS.md`. Architecture and API docs live under `docs/`.

## Project structure

```
src/
├── app/                 # App shell: router, auth, settings, sessions, jobs, generations
├── pages/               # Top-level route pages (dashboard, activities, consumption, …)
├── components/          # Shared UI (ui/ primitives + _shared layout)
├── collectors/          # Source collectors (claude-code, codex, grok, hermes, …)
├── collector-main.ts    # Desktop collector entrypoint
├── server/              # Express API (server.ts, auth, routes/, privacy/)
├── db/                  # Schema, migrations, query modules
├── services/            # Provider connectors, reconciliation, source health, …
├── lib/                 # Frontend utilities + API client helpers
├── hooks/               # React hooks (SSE, …)
├── types/               # Shared TypeScript types
├── __tests__/           # Unit + integration tests (mirrors src/)
└── styles/              # Global CSS
deploy/                  # systemd units + env/config examples
docs/                    # Architecture, API, deployment, spend reconciliation
e2e/                     # Playwright tests
```

## Documentation

| Doc | Contents |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System topology, data model, cost/capacity classes, routes |
| [docs/API_SPECIFICATION.md](docs/API_SPECIFICATION.md) | REST + SSE endpoint overview |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Local + Tailscale + systemd deployment |
| [docs/spend-reconciliation.md](docs/spend-reconciliation.md) | Provider vs agent spend linking rules |
| [docs/provider-capacity-research.md](docs/provider-capacity-research.md) | Provider capacity/quota research notes |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Dev setup and contribution notes |
| [CLAUDE.md](CLAUDE.md) | Agent/editor project guidance |

## Auth (optional in dev)

When `MC_AUTH_ENABLED=true`, the UI uses JWT sessions (HttpOnly cookie) and
collectors authenticate ingest with `MC_API_KEY`. See
`deploy/server.env.example` and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## License

Private
