# Mission Control

A React + TypeScript + Vite application for managing team workflows and agent
usage across Claude Code, Codex, Grok, and local inference sources.

## Package Manager

This project uses **Bun** as the package manager and runtime.

### Prerequisites

- [Bun](https://bun.sh) 1.0+

### Install Bun

```bash
curl -fsSL https://bun.sh/install | bash
```

Restart your terminal or run `source ~/.bashrc` (or `~/.zshrc`) to add Bun to your PATH.

## Quick Start

```bash
# Install dependencies
bun install

# Start development server (with hot reload)
bun run dev

# Build for production
bun run build

# Run linter
bun run lint
```

The development server will start at `http://localhost:5173`.

## Available Scripts

| Script                  | Description                            |
| ----------------------- | -------------------------------------- |
| `bun run dev`           | Start dev server with Bun's hot reload |
| `bun run build`         | Build with Bun runtime                 |
| `bun run lint`          | Run ESLint with Bun                    |
| `bun run preview`       | Preview production build               |
| `bun run api`           | Start API server                       |
| `bun run test`          | Run tests                              |
| `bun run test:watch`    | Run tests in watch mode                |
| `bun run test:coverage` | Run tests with coverage                |

## Building for Production

```bash
bun run build
```

Output is generated in the `dist/` directory.

## Project Structure

```
src/
  components/    # Reusable UI components
  pages/         # Page components
  lib/           # Utility functions
  hooks/         # Custom React hooks
  types/         # TypeScript types
public/          # Static assets
dist/            # Build output
docs/            # Documentation
  SKILLS.md      # OpenClaw skills reference (session-logs, etc.)
```

## Lockfile

- `bun.lock` — Bun lockfile (committed to source control)

## ESLint Configuration

For production applications, we recommend enabling type-aware lint rules. See the [ESLint configuration guide](https://typescript-eslint.io/getting-started/typed-linting/) for details.

## License

Private - Orca Team
