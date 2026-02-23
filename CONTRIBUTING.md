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
git clone https://github.com/BenBish/mission-control.git
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
