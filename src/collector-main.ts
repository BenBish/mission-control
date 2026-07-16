/**
 * Desktop collector entrypoint. Reads ~/.config/mission-control/collector.toml
 * and runs the Claude Code + Codex + Grok collectors against the server over
 * HTTP (Tailscale). See deploy/mc-collector.service for the systemd unit
 * and deploy/collector.toml.example for the config shape.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { Scheduler } from "./collectors/core/scheduler.js";
import { HttpSink } from "./collectors/core/sinks.js";
import { CollectorStateStore } from "./collectors/core/state-store.js";
import { ClaudeCodeCollector } from "./collectors/claude-code/collector.js";
import { CodexCollector } from "./collectors/codex/collector.js";
import { GrokCollector } from "./collectors/grok/collector.js";

const CONFIG_PATH = path.join(
  os.homedir(),
  ".config",
  "mission-control",
  "collector.toml",
);

interface CollectorConfig {
  serverUrl: string;
  apiKey: string;
  machine?: string;
}

/**
 * Minimal flat TOML subset: `key = "value"` / `key = value` lines, '#'
 * comments, no nested tables. The config this collector needs (server_url,
 * api_key, machine) doesn't need more than that — not pulling in a TOML
 * dependency for three scalar fields.
 */
function parseMinimalToml(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function loadConfig(): CollectorConfig {
  let raw: string;
  try {
    raw = fs.readFileSync(CONFIG_PATH, "utf-8");
  } catch {
    throw new Error(
      `Missing collector config at ${CONFIG_PATH}. Copy deploy/collector.toml.example there and fill in server_url/api_key.`,
    );
  }
  const parsed = parseMinimalToml(raw);
  if (!parsed.server_url || !parsed.api_key) {
    throw new Error(`${CONFIG_PATH} must set server_url and api_key`);
  }
  return {
    serverUrl: parsed.server_url.replace(/\/$/, ""),
    apiKey: parsed.api_key,
    machine: parsed.machine,
  };
}

async function main() {
  const config = loadConfig();
  console.log(`[collector] server: ${config.serverUrl}`);

  const state = new CollectorStateStore();
  const sink = new HttpSink({
    serverUrl: config.serverUrl,
    apiKey: config.apiKey,
  });

  const collectors = [
    new ClaudeCodeCollector(state),
    new CodexCollector(state),
    new GrokCollector(state),
  ];
  const scheduler = new Scheduler(collectors, sink);

  process.on("SIGINT", () => {
    console.log("[collector] shutting down...");
    scheduler.stop();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    scheduler.stop();
    process.exit(0);
  });

  scheduler.start();
  console.log(`[collector] started ${collectors.length} collectors`);
}

main().catch((err) => {
  console.error("[collector] fatal:", err);
  process.exit(1);
});
