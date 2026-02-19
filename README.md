# Mission Control

A React + TypeScript + Vite application for managing team workflows.

## Package Manager Support

This project supports both **npm** (default) and **Bun** (faster). You can use either interchangeably.

### Using npm (Default)

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Run linter
npm run lint
```

### Using Bun (Recommended for Speed)

[Bun](https://bun.sh) is a fast all-in-one JavaScript runtime & package manager. Install times are typically 3-5x faster than npm.

#### Install Bun

```bash
curl -fsSL https://bun.sh/install | bash
```

Restart your terminal or run `source ~/.bashrc` (or `~/.zshrc`) to add Bun to your PATH.

#### Using Bun with this project

```bash
# Install dependencies (much faster!)
bun install

# Start development server with hot reload
bun run dev:bun

# Build for production
bun run build:bun

# Run linter
bun run lint:bun
```

#### Bun Scripts Available

| Script | Description |
|--------|-------------|
| `bun run dev:bun` | Start dev server with Bun's hot reload |
| `bun run build:bun` | Build with Bun runtime |
| `bun run lint:bun` | Run ESLint with Bun |

### Hybrid Workflow

The project maintains compatibility with both package managers:

- `package-lock.json` - npm lockfile (committed)
- `bun.lockb` - Bun lockfile (committed)

Both lockfiles are kept in sync. Team members can choose their preferred package manager.

## Development

### Prerequisites

- Node.js 20+ (for npm)
- OR Bun 1.0+ (for Bun)

### Quick Start

```bash
# Using npm
npm install
npm run dev

# OR using Bun
bun install
bun run dev:bun
```

The development server will start at `http://localhost:5173`.

## Building for Production

```bash
# Using npm
npm run build

# Using Bun (faster)
bun run build:bun
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

## ESLint Configuration

For production applications, we recommend enabling type-aware lint rules. See the [ESLint configuration guide](https://typescript-eslint.io/getting-started/typed-linting/) for details.

## License

Private - Orca Team
