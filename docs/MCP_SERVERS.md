# MCP Server Configuration

This document describes the MCP (Model Context Protocol) servers configured for the OpenClaw team via the `openclaw-mcp-adapter` plugin.

## Overview

MCP servers extend agent capabilities by providing additional tools through the Model Context Protocol. They are configured in `openclaw.json` under `plugins.entries.openclaw-mcp-adapter.config.servers`.

## Configured Servers

### Linear

- **Name:** `linear`
- **Transport:** HTTP (Streamable HTTP)
- **URL:** `https://mcp.linear.app/mcp`
- **Auth:** Bearer token via `LINEAR_API_KEY` environment variable
- **Purpose:** Project management — issue tracking, team management, milestones

### Brave Search

- **Name:** `brave-search`
- **Transport:** stdio
- **Package:** `@brave/brave-search-mcp-server`
- **Auth:** API key via `BRAVE_API_KEY` environment variable
- **Purpose:** Web search capabilities for agents

**Registered Tools:**
| Tool | Description |
|------|-------------|
| `brave-search_brave_web_search` | General web search |
| `brave-search_brave_local_search` | Local/geographic search |
| `brave-search_brave_video_search` | Video search |
| `brave-search_brave_image_search` | Image search |
| `brave-search_brave_news_search` | News search |
| `brave-search_brave_summarizer` | AI-powered search summarization |

## Environment Variables

The following environment variables must be set in the OpenClaw team `.env` file (`~/.openclaw-team/.env`):

| Variable | Description | Required By |
|----------|-------------|-------------|
| `LINEAR_API_KEY` | Linear API key for project management | Linear MCP |
| `BRAVE_API_KEY` | Brave Search API key | Brave Search MCP |

### Obtaining API Keys

- **Linear:** Generate at [Linear Settings → API](https://linear.app/settings/api)
- **Brave Search:** Sign up at [Brave Search API](https://brave.com/search/api/)

## Configuration Reference

The MCP adapter configuration in `openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "openclaw-mcp-adapter": {
        "enabled": true,
        "config": {
          "servers": [
            {
              "name": "linear",
              "transport": "http",
              "url": "https://mcp.linear.app/mcp",
              "headers": {
                "Authorization": "Bearer ${LINEAR_API_KEY}"
              }
            },
            {
              "name": "brave-search",
              "transport": "stdio",
              "command": "npx",
              "args": ["-y", "@brave/brave-search-mcp-server"],
              "env": {
                "BRAVE_API_KEY": "${BRAVE_API_KEY}"
              }
            }
          ]
        }
      }
    }
  }
}
```

## Adding New MCP Servers

To add a new MCP server:

1. Add an entry to the `servers` array in `openclaw.json`
2. Set any required environment variables in `.env`
3. Restart the gateway: `openclaw gateway restart`
4. Verify in logs: look for `[mcp-adapter] Registered: <server>_<tool>` entries

### Supported Transports

- **`stdio`** — Server runs as a child process (most common for npm packages)
- **`http`** — Server accessible via HTTP endpoint (Streamable HTTP transport)

## Troubleshooting

### Server fails to connect

Check the OpenClaw logs:
```bash
grep "mcp-adapter" /tmp/openclaw/openclaw-$(date +%Y-%m-%d).log
```

Common issues:
- Missing or invalid API key in environment
- Package not found (check npm registry access)
- Network connectivity for HTTP transport servers

### "No servers configured"

This means the `openclaw-mcp-adapter` plugin loaded but found no servers in its config. Verify:
1. The `config.servers` array exists and is non-empty in `openclaw.json`
2. The plugin entry has `"enabled": true`
3. Restart the gateway after config changes
