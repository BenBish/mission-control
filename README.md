# Mission Control

A React + TypeScript + Vite application for managing team workflows.

## Package Manager

This project uses **Bun** as the primary package manager and runtime. npm fallback scripts are available for CI/CD compatibility (until CI migrates to Bun).

### Prerequisites

- [Bun](https://bun.sh) 1.0+ (primary)
- Node.js 20+ (only needed for npm fallback scripts)

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

| Script | Description |
|--------|-------------|
| `bun run dev` | Start dev server with Bun's hot reload |
| `bun run build` | Build with Bun runtime |
| `bun run lint` | Run ESLint with Bun |
| `bun run preview` | Preview production build |
| `bun run api` | Start API server |
| `bun run test` | Run tests |
| `bun run test:watch` | Run tests in watch mode |
| `bun run test:coverage` | Run tests with coverage |

### npm Fallback Scripts

These are kept for CI/CD compatibility and will be removed once CI migrates to Bun:

| Script | Description |
|--------|-------------|
| `bun run dev:npm` | Start dev server (npm/Vite only) |
| `bun run build:npm` | Build with npm toolchain |
| `bun run lint:npm` | Run ESLint without Bun |

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
```

## Lockfiles

Both lockfiles are committed for compatibility during the migration period:

- `bun.lock` — Bun lockfile (primary)
- `package-lock.json` — npm lockfile (kept for CI/CD until Phase 4)

## ESLint Configuration

For production applications, we recommend enabling type-aware lint rules. See the [ESLint configuration guide](https://typescript-eslint.io/getting-started/typed-linting/) for details.

## License

Private - Orca Team
