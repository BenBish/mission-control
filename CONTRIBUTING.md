# Contributing to Mission Control

## Developer setup

### 1. Install Bun

```bash
curl -fsSL https://bun.sh/install | bash
```

Restart the shell, then verify: `bun --version` (1.0+).

### 2. Clone and install

```bash
git clone https://github.com/BenBish/mission-control.git
cd mission-control
bun install
```

### 3. Run locally

```bash
# Terminal 1
bun run api          # http://127.0.0.1:3001

# Terminal 2
bun run dev          # http://localhost:3000 (proxies /api)
```

```bash
bun run lint
bun test
bun run ci           # lint + prettier + typecheck + tests
bun run build        # frontend → dist-vite/
```

Optional desktop collector: copy `deploy/collector.toml.example` to
`~/.config/mission-control/collector.toml`, then `bun run collector`.

## Code style

- Follow existing patterns and TypeScript strictness
- Prefer domain modules under `src/server/routes/` and `src/db/queries/`
- Keep provider billing, agent usage, quota, wallet, and estimates separate
  (see `docs/ARCHITECTURE.md`)
- Run `bun run ci` before opening a PR

## Documentation

Architecture-affecting changes should update docs in the same PR. Checklist:

`docs/ARCHITECTURE.md` → *Documentation freshness checklist*.

## Commit messages

Prefer Linear-linked prefixes used by this repo:

```
[BSH-XX] Short description
```

Conventional Commits (`feat:`, `fix:`, `docs:`) are also acceptable when no
issue key applies.

## Pull requests

1. Branch from `main` (`BSH-XX-slug`)
2. Implement + tests
3. `bun run ci`
4. Open PR with Linear issue link
5. Update docs if routes/schema/deploy changed
