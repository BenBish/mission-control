#!/usr/bin/env bash
set -euo pipefail

# Cleanup stale git worktrees whose Linear issues are Done or Canceled.
# Dry-run by default; pass --apply to actually remove worktrees and delete remote branches.

APPLY=false
if [[ "${1:-}" == "--apply" ]]; then
  APPLY=true
fi

# --- Dependency checks ---

if ! command -v jq &>/dev/null; then
  echo "ERROR: jq is required but not found. Install it first." >&2
  exit 1
fi

if ! command -v curl &>/dev/null; then
  echo "ERROR: curl is required but not found." >&2
  exit 1
fi

if [[ -z "${LINEAR_API_KEY:-}" ]]; then
  echo "ERROR: LINEAR_API_KEY environment variable is not set." >&2
  exit 1
fi

LINEAR_API="https://api.linear.app/graphql"

# Query Linear for an issue's state by identifier (e.g. ORC-58)
get_issue_state() {
  local identifier="$1"
  local query
  query=$(cat <<GRAPHQL
{"query": "{ searchIssues(term: \"${identifier}\", first: 1) { nodes { identifier state { name type } } } }"}
GRAPHQL
)

  local response
  response=$(curl -s --max-time 10 -X POST "$LINEAR_API" \
    -H "Content-Type: application/json" \
    -H "Authorization: ${LINEAR_API_KEY}" \
    -d "$query" 2>/dev/null) || return 1

  local state_name state_type
  state_name=$(echo "$response" | jq -r '.data.searchIssues.nodes[0].state.name // empty' 2>/dev/null) || return 1
  state_type=$(echo "$response" | jq -r '.data.searchIssues.nodes[0].state.type // empty' 2>/dev/null) || return 1

  if [[ -z "$state_name" || -z "$state_type" ]]; then
    return 1
  fi

  echo "${state_name}|${state_type}"
}

echo "=== Stale Worktree Cleanup ==="
if $APPLY; then
  echo "Mode: APPLY (changes will be made)"
else
  echo "Mode: DRY-RUN (no changes will be made, use --apply to execute)"
fi
echo ""

while IFS= read -r line; do
  # git worktree list output: /path/to/worktree  <commit>  [branch] or (bare)
  worktree_path=$(echo "$line" | awk '{print $1}')

  # Skip bare repo
  if echo "$line" | grep -q '(bare)'; then
    echo "[SKIP] ${worktree_path} — bare repo"
    continue
  fi

  # Extract branch name from [brackets]
  branch=$(echo "$line" | grep -oP '\[.*?\]' | tr -d '[]')
  if [[ -z "$branch" ]]; then
    echo "[SKIP] ${worktree_path} — could not determine branch"
    continue
  fi

  # Skip main
  if [[ "$branch" == "main" || "$branch" == "master" ]]; then
    echo "[SKIP] ${worktree_path} (branch: ${branch}) — protected"
    continue
  fi

  # Extract ORC-XXX identifier (case-insensitive)
  issue_id=$(echo "$branch" | grep -ioP 'ORC-\d+' | head -1 | tr '[:lower:]' '[:upper:]') || true
  if [[ -z "$issue_id" ]]; then
    echo "[SKIP] ${worktree_path} (branch: ${branch}) — no ORC issue found"
    continue
  fi

  # Query Linear for issue state
  state_info=$(get_issue_state "$issue_id") || true
  if [[ -z "$state_info" ]]; then
    echo "[WARN] ${worktree_path} (branch: ${branch}) — failed to query ${issue_id} from Linear, skipping"
    continue
  fi

  state_name="${state_info%%|*}"
  state_type="${state_info##*|}"

  if [[ "$state_type" == "completed" || "$state_type" == "canceled" ]]; then
    if $APPLY; then
      echo "[REMOVING] ${worktree_path} (branch: ${branch}) — ${issue_id} is ${state_name}"

      if git worktree remove --force "$worktree_path" 2>/dev/null; then
        echo "  → Removed worktree"
      else
        echo "  → WARNING: Failed to remove worktree" >&2
      fi

      if git push origin --delete "$branch" 2>/dev/null; then
        echo "  → Deleted remote branch"
      else
        echo "  → WARNING: Failed to delete remote branch (may already be deleted)" >&2
      fi
    else
      echo "[STALE] ${worktree_path} (branch: ${branch}) — ${issue_id} is ${state_name}"
    fi
  else
    echo "[KEEP] ${worktree_path} (branch: ${branch}) — ${issue_id} is ${state_name}"
  fi
done < <(git worktree list)

echo ""
if ! $APPLY; then
  echo "Dry-run complete. Run with --apply to remove stale worktrees."
fi
