# Contributing to Mission Control

## Developer Setup

### 1. Install Bun

Bun is our primary package manager and runtime. Install it first:

```bash
curl -fsSL https://bun.sh/install | bash
```

Restart your terminal or run `source ~/.bashrc` / `source ~/.zshrc`.

Verify the installation:

```bash
bun --version   # Should show 1.0+
```

### 2. Clone and Install

```bash
git clone <repo-url>
cd mission-control
bun install
```

### 3. Start Developing

```bash
bun run dev       # Start dev server with hot reload
bun run build     # Build for production
bun run lint      # Run linter
bun run test      # Run tests
```

## Migrating from npm

If you were previously using npm, here's how to switch:

1. **Install Bun** (see above)
2. **Run `bun install`** — this uses `package.json` just like npm, but installs much faster
3. **Use `bun run` instead of `npm run`** — all scripts work the same way
4. **Key changes:**
   - `npm install` → `bun install`
   - `npm run dev` → `bun run dev`
   - `npm run build` → `bun run build`
   - `npm run lint` → `bun run lint`

### What about npm?

npm fallback scripts (`dev:npm`, `build:npm`, `lint:npm`) are available for CI/CD compatibility. These will be removed once CI migrates to Bun (Phase 4 of ORC-10).

Do **not** remove `package-lock.json` — it's still needed for CI/CD.

## Code Style

- Follow existing codebase patterns and naming conventions
- Use TypeScript strict mode
- Run `bun run lint` before committing
- Write tests for new features

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(scope): description
fix(scope): description
docs(scope): description
```

## Pull Requests

1. Create a feature branch from `main`
2. Make your changes
3. Run `bun run lint` and `bun run build` to verify
4. Open a PR with a clear description
5. Link any related Linear issues
