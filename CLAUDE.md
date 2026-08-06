# Mission Control

Activity monitoring dashboard for multi-source AI agents and local inference.
React frontend + Express API + SQLite.

## Stack

- **Frontend:** React 19, React Router 7, Tailwind CSS v4, Radix UI, Recharts, shadcn/ui-style components
- **Backend:** Express.js REST API (port 3001), SQLite via `sqlite3`/`sqlite`
- **Runtime:** Bun (test runner, dev server, package manager)
- **Build:** Vite + TypeScript → `dist-vite/`

## Commands

```bash
bun run dev          # Vite dev server (port 3000, proxies /api → 3001)
bun run api          # API server (port 3001, loopback by default)
bun run collector    # Desktop collector → HTTP ingest
bun test             # Unit/integration tests
bun run lint         # ESLint
bun run ci           # Full CI: lint + prettier + typecheck + tests
bun run build        # Production frontend build (dist-vite/)
```

Always run `bun run ci` before committing.

## Project Structure

```
src/
├── server/           # Express API (server.ts, auth, routes/, privacy/)
├── collectors/       # Per-source collectors + core scheduler/sinks
├── collector-main.ts # Desktop collector entrypoint
├── db/               # Schema, migrations, query modules
├── services/         # Provider connectors, reconciliation, health, …
├── app/              # Router, auth, settings, sessions, jobs, generations
├── pages/            # Top-level page components
├── components/       # ui/ primitives + _shared layout
├── hooks/            # React hooks (SSE, …)
├── lib/              # Frontend utilities + query helpers
├── types/            # TypeScript types
├── __tests__/        # Unit + integration tests (mirrors src/)
└── styles/           # Global CSS
deploy/               # systemd + env examples
docs/                 # Architecture, API, deployment
e2e/                  # Playwright
```

## Architecture notes for agents

- API lives under **`src/server/`**, not `src/api/`
- Routes are modular: `src/server/routes/*.ts`
- Real-time updates via SSE (`/api/stream`)
- Vite proxies `/api` to the Express backend in dev
- Source-scoped data (`source_id` / instances), global Source filter in UI
- **Five cost/capacity data classes** (do not double-count): cost, usage, quota,
  wallet, estimate — see `docs/ARCHITECTURE.md`
- Prefer updating docs when changing routes, schema, collectors, auth, or deploy

## Testing

Tests live in `src/__tests__/` mirroring the source structure. Use Bun test runner.

```bash
bun test
bun test src/__tests__/server/query.test.ts
bun test --watch
```

## Browser Access (Playwright CLI)

When writing E2E tests or debugging UI issues, use `playwright-cli` to inspect live pages:

```bash
playwright-cli open http://localhost:3000
playwright-cli snapshot
playwright-cli screenshot
playwright-cli click e6
playwright-cli fill e12 "search text"
playwright-cli close
```

Use `-s=<name>` for isolated sessions. Element refs from `snapshot` show the
rendered DOM — use them for selectors instead of guessing from source.

## Code Style

- Follow existing patterns in the codebase
- Radix UI primitives for interactive components
- Tailwind for styling (no CSS modules)
- `class-variance-authority` + `clsx` + `tailwind-merge` for component variants
- Lucide React for icons
- Keep API routes RESTful, return JSON

## Git

- Commit messages: `[BSH-XX] Description` (Linear issue key)
- Create PRs with `gh pr create`
- Branch naming: `BSH-XX-slug` (or `feat/BSH-XX-slug` / `fix/BSH-XX-slug`)

## Documentation freshness

When architecture changes, update the matching docs in the same PR (checklist in
`docs/ARCHITECTURE.md`). Do not reintroduce removed paths (`src/api/`, Skills UI,
`docs/SKILLS.md`).
