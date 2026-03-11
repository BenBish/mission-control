# Mission Control

Activity monitoring dashboard for the OpenClaw agent system. React frontend + Express API + SQLite.

## Stack

- **Frontend:** React 19, React Router 7, Tailwind CSS v4, Radix UI, Recharts, shadcn/ui-style components
- **Backend:** Express.js REST API (port 3001), SQLite via `sqlite3`/`sqlite`
- **Runtime:** Bun (test runner, dev server, package manager)
- **Build:** Vite + TypeScript

## Commands

```bash
bun run dev          # Start Vite dev server (port 3000, proxies /api to 3001)
bun run api          # Start API server (port 3001)
bun test             # Run unit/integration tests
bun run lint         # ESLint
bun run ci           # Full CI: lint + prettier + typecheck + tests
bun run build        # Production build
```

Always run `bun run ci` before committing.

## Project Structure

```
src/
├── api/              # Express routes, middleware, services
│   ├── server.ts     # API entry point
│   ├── routes.ts     # All route definitions
│   ├── auth.ts       # Authentication
│   ├── middleware/    # Express middleware
│   └── services/     # Business logic (cost-linker, cron, profiles, session-log-scanner)
├── pages/            # React page components (one per route)
├── components/       # Shared React components
│   ├── ui/           # Base UI primitives (shadcn/ui style)
│   └── _shared/      # App-level shared components
├── hooks/            # React hooks
├── lib/              # Utilities
├── db/               # Database schema, migrations
├── services/         # Frontend services
├── types/            # TypeScript types
├── __tests__/        # Unit + integration tests (mirrors src/ structure)
└── styles/           # Global CSS
```

## Architecture

- Frontend uses lazy-loaded pages via `React.lazy` + `Suspense`
- `MainLayout` with sidebar nav (desktop + mobile sheet)
- ThemeProvider (light/dark toggle, persisted)
- API uses profile-scoped data isolation
- Real-time updates via SSE (`/api/stream`)
- Vite dev server proxies `/api` requests to the Express backend

## Testing

Tests live in `src/__tests__/` mirroring the source structure. Use Bun test runner.

```bash
bun test                                    # All tests
bun test src/__tests__/api/routes.test.ts   # Single file
bun test --watch                            # Watch mode
```

## Browser Access (Playwright CLI)

When writing E2E tests or debugging UI issues, use `playwright-cli` to inspect live pages:

```bash
playwright-cli open http://localhost:3000    # Open the app
playwright-cli snapshot                      # Accessibility tree with element refs (e2, e3...)
playwright-cli screenshot                    # Visual capture
playwright-cli click e6                      # Click element by ref
playwright-cli fill e12 "search text"        # Fill input by ref
playwright-cli close                         # Close browser
```

Use `-s=<name>` for isolated sessions (e.g. `-s=debug` to keep separate from test runs).

Element refs from `snapshot` show the actual rendered DOM structure — use these to write correct selectors instead of guessing from source code.

## Code Style

- Follow existing patterns in the codebase
- Radix UI primitives for interactive components
- Tailwind for styling (no CSS modules)
- `class-variance-authority` + `clsx` + `tailwind-merge` for component variants
- Lucide React for icons
- Keep API routes RESTful, return JSON

## Git

- Commit messages: `[ORC-XX] Description`
- Create PRs with `gh pr create`
- Branch naming: `feat/ORC-XX-slug` or `fix/ORC-XX-slug`
