# OpenClaw Skills Reference

Skills are built-in capabilities that extend what OpenClaw agents can do. They provide structured instructions and tooling for specific tasks — from searching session logs to managing notes and integrations.

This document covers skills relevant to the Mission Control team workflow.

---

## 📜 session-logs

**Search and analyze agent session logs using `jq` and `rg`.**

The `session-logs` skill lets agents query their own conversation history stored in JSONL session files. Use it for debugging agent behavior, analyzing decision patterns, auditing tool usage, and reviewing past conversations.

### Prerequisites

- `jq` (JSON processor)
- `rg` (ripgrep — fast text search)

### Session Log Location

```
~/.openclaw/agents/<agentId>/sessions/
```

Each agent has its own sessions directory. The `<agentId>` comes from the `agent=<id>` value in the Runtime line of the system prompt.

- **`sessions.json`** — Index mapping session keys to session IDs
- **`<session-id>.jsonl`** — Full conversation transcript per session

### Log Structure

Each `.jsonl` file contains one JSON object per line:

| Field | Description |
|-------|-------------|
| `type` | `"session"` (metadata) or `"message"` |
| `timestamp` | ISO 8601 timestamp |
| `message.role` | `"user"`, `"assistant"`, or `"toolResult"` |
| `message.content[]` | Array of content blocks (text, thinking, toolCall) |
| `message.content[].type` | `"text"`, `"thinking"`, `"toolCall"`, `"toolResult"` |
| `message.usage.cost.total` | Cost per response (USD) |

### Common Queries

#### List all sessions by date and size

```bash
AGENT_ID=main  # or your agent id
for f in ~/.openclaw/agents/$AGENT_ID/sessions/*.jsonl; do
  date=$(head -1 "$f" | jq -r '.timestamp' | cut -dT -f1)
  size=$(ls -lh "$f" | awk '{print $5}')
  echo "$date $size $(basename $f)"
done | sort -r
```

#### Find sessions from a specific day

```bash
for f in ~/.openclaw/agents/$AGENT_ID/sessions/*.jsonl; do
  head -1 "$f" | jq -r '.timestamp' | grep -q "2026-02-23" && echo "$f"
done
```

#### Extract user messages from a session

```bash
jq -r 'select(.message.role == "user") | .message.content[]? | select(.type == "text") | .text' <session>.jsonl
```

#### Search for a keyword in assistant responses

```bash
jq -r 'select(.message.role == "assistant") | .message.content[]? | select(.type == "text") | .text' <session>.jsonl | rg -i "keyword"
```

#### Get total cost for a session

```bash
jq -s '[.[] | .message.usage.cost.total // 0] | add' <session>.jsonl
```

#### Daily cost summary across all sessions

```bash
for f in ~/.openclaw/agents/$AGENT_ID/sessions/*.jsonl; do
  date=$(head -1 "$f" | jq -r '.timestamp' | cut -dT -f1)
  cost=$(jq -s '[.[] | .message.usage.cost.total // 0] | add' "$f")
  echo "$date $cost"
done | awk '{a[$1]+=$2} END {for(d in a) print d, "$"a[d]}' | sort -r
```

#### Count messages and tokens in a session

```bash
jq -s '{
  messages: length,
  user: [.[] | select(.message.role == "user")] | length,
  assistant: [.[] | select(.message.role == "assistant")] | length,
  first: .[0].timestamp,
  last: .[-1].timestamp
}' <session>.jsonl
```

#### Tool usage breakdown

```bash
jq -r '.message.content[]? | select(.type == "toolCall") | .name' <session>.jsonl \
  | sort | uniq -c | sort -rn
```

#### Search across ALL sessions for a phrase

```bash
rg -l "search phrase" ~/.openclaw/agents/$AGENT_ID/sessions/*.jsonl
```

#### Fast text-only extraction (low noise)

```bash
jq -r 'select(.type=="message") | .message.content[]? | select(.type=="text") | .text' \
  ~/.openclaw/agents/$AGENT_ID/sessions/<id>.jsonl | rg 'keyword'
```

### Use Cases for Mission Control

#### Debugging Agent Behavior

When an agent makes an unexpected decision, search its session logs to trace the reasoning:

```bash
# Find sessions where an agent encountered errors
rg -l '"error"' ~/.openclaw/agents/main/sessions/*.jsonl

# Extract the assistant's reasoning around a specific tool call
jq -r 'select(.message.role == "assistant") | .message.content[]? | select(.type == "text") | .text' <session>.jsonl | rg -C 3 "error\|failed\|unexpected"
```

#### Analyzing Session History

Review what happened in a specific session for QA or post-mortem:

```bash
# Full conversation flow (user and assistant messages only)
jq -r 'select(.type == "message") |
  "\(.timestamp) [\(.message.role)] " +
  ([.message.content[]? | select(.type == "text") | .text] | join(" "))' <session>.jsonl
```

#### Cost Analysis

Track spending by agent and day — useful for the Mission Control cost dashboard:

```bash
# Total cost across all sessions
for f in ~/.openclaw/agents/main/sessions/*.jsonl; do
  jq -s '[.[] | .message.usage.cost.total // 0] | add' "$f"
done | awk '{s+=$1} END {printf "$%.4f\n", s}'
```

#### QA Review — Find All System Messages

```bash
jq -r 'select(.message.role == "user") |
  select(.message.content[]? | .text? // "" | test("\\[cron:|\\[system")) |
  "\(.timestamp) \(.message.content[0].text[0:100])"' <session>.jsonl
```

### Tips

- Sessions are **append-only** JSONL (one JSON object per line)
- Large sessions can be several MB — use `head`/`tail` for sampling
- The `sessions.json` index maps chat providers (Discord, WhatsApp, etc.) to session IDs
- Deleted sessions have a `.deleted.<timestamp>` suffix
- Filter `type=="text"` in content arrays to skip thinking blocks and tool calls

---

## Other Available Skills

OpenClaw ships with many built-in skills. Commonly useful ones for team workflows:

| Skill | Description |
|-------|-------------|
| `session-logs` | Search and analyze agent conversation history |
| `model-usage` | Track model usage and costs |
| `github` | GitHub integration (PRs, issues, repos) |
| `coding-agent` | Code generation and editing assistance |
| `discord` | Discord messaging integration |
| `slack` | Slack messaging integration |
| `todoist` | Task management via Todoist |
| `canvas` | Present UI canvases to users |

Skills are located at the OpenClaw installation path under `skills/`. Each skill has a `SKILL.md` with full documentation.

To check available skills on your installation:

```bash
ls $(dirname $(which openclaw))/../lib/node_modules/openclaw/skills/
```
