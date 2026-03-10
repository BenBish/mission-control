# Maintenance

## Stale Worktree Cleanup

`scripts/cleanup-stale-worktrees.sh` automates removal of git worktrees and remote branches for Linear issues that are Done or Canceled.

### How It Works

1. Lists all git worktrees via `git worktree list`
2. Extracts `ORC-XXX` issue identifiers from branch names
3. Queries the Linear GraphQL API for each issue's state
4. If the issue is completed or canceled, marks the worktree as stale for removal

### Prerequisites

- `LINEAR_API_KEY` environment variable set to your Linear API key
- `curl`
- `jq`

### Usage

**Dry-run (default)** — shows what would be removed without making changes:

```bash
LINEAR_API_KEY=lin_api_xxx ./scripts/cleanup-stale-worktrees.sh
```

**Apply** — removes stale worktrees and deletes remote branches:

```bash
LINEAR_API_KEY=lin_api_xxx ./scripts/cleanup-stale-worktrees.sh --apply
```

### What Gets Skipped

- The `main` (or `master`) branch worktree — always protected
- The bare repo entry — not a real worktree
- Worktrees whose branch name doesn't contain an `ORC-XXX` pattern
- Worktrees where the Linear API query fails — skipped with a warning

### Error Handling

- Linear API failures: prints a warning and skips the worktree
- `git worktree remove` failures: prints a warning and continues
- Remote branch deletion failures: prints a warning and continues (branch may already be deleted)
