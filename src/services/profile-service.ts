/**
 * Profile Service
 * Discovers OpenClaw gateway profiles via systemd services and filesystem scanning.
 * Caches results for 30 seconds to avoid repeated probes.
 */

import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import type { Profile } from "../types/profile.js";

const CACHE_TTL_MS = 30_000;
const PROBE_TIMEOUT_MS = 3_000;

interface CacheEntry {
  profiles: Profile[];
  expiry: number;
}

let cache: CacheEntry | null = null;

/**
 * Probe a gateway URL to check if it's reachable.
 * Returns true if the gateway responds within the timeout.
 */
async function probeGateway(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}

/**
 * Parse a systemd service file to extract profile information.
 */
async function parseSystemdService(
  filePath: string,
): Promise<{
  profile: string;
  port: number;
  stateDir: string;
  unit: string;
} | null> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const lines = content.split("\n");

    let port: number | null = null;
    let profile: string | null = null;
    let stateDir: string | null = null;

    for (const line of lines) {
      const trimmed = line.trim();

      // Parse Environment= lines
      if (trimmed.startsWith("Environment=")) {
        const value = trimmed.slice("Environment=".length).replace(/^"|"$/g, "");

        if (value.startsWith("OPENCLAW_GATEWAY_PORT=")) {
          port = parseInt(value.split("=")[1], 10);
        } else if (value.startsWith("OPENCLAW_PROFILE=")) {
          profile = value.split("=")[1];
        } else if (value.startsWith("OPENCLAW_STATE_DIR=")) {
          stateDir = value.split("=")[1];
        }
      }
    }

    if (port === null) return null;

    const unit = path.basename(filePath);

    // Default profile is "default" if OPENCLAW_PROFILE is not set
    // (the main gateway without a profile name)
    if (profile === null) {
      profile = "default";
    }

    // Default state dir
    if (stateDir === null) {
      stateDir =
        profile === "default"
          ? path.join(os.homedir(), ".openclaw")
          : path.join(os.homedir(), `.openclaw-${profile}`);
    }

    return { profile, port, stateDir, unit };
  } catch {
    return null;
  }
}

/**
 * Discover profiles from systemd service files.
 */
async function discoverFromSystemd(): Promise<Profile[]> {
  const systemdDir = path.join(
    os.homedir(),
    ".config",
    "systemd",
    "user",
  );

  let files: string[];
  try {
    const dirEntries = await fs.readdir(systemdDir);
    files = dirEntries.filter(
      (f) =>
        f.startsWith("openclaw-gateway") && f.endsWith(".service"),
    );
  } catch {
    return [];
  }

  const profiles: Profile[] = [];

  for (const file of files) {
    const filePath = path.join(systemdDir, file);
    const parsed = await parseSystemdService(filePath);
    if (!parsed) continue;

    const gatewayUrl = `http://127.0.0.1:${parsed.port}`;
    const isOnline = await probeGateway(gatewayUrl);

    profiles.push({
      id: parsed.profile,
      name: parsed.profile === "default" ? "Default" : titleCase(parsed.profile),
      gatewayUrl,
      port: parsed.port,
      status: isOnline ? "online" : "offline",
      stateDir: parsed.stateDir,
      systemdUnit: parsed.unit,
    });
  }

  return profiles;
}

/**
 * Discover profiles from the PROFILES environment variable.
 * Format: "name:port:stateDir,name:port:stateDir,..."
 */
function discoverFromEnv(): Profile[] {
  const envProfiles = process.env.PROFILES;
  if (!envProfiles) return [];

  const profiles: Profile[] = [];

  for (const entry of envProfiles.split(",")) {
    const parts = entry.trim().split(":");
    if (parts.length < 2) continue;

    const [name, portStr, stateDir] = parts;
    const port = parseInt(portStr, 10);
    if (isNaN(port)) continue;

    profiles.push({
      id: name,
      name: name === "default" ? "Default" : titleCase(name),
      gatewayUrl: `http://127.0.0.1:${port}`,
      port,
      status: "offline", // Will be probed below
      stateDir: stateDir || path.join(os.homedir(), `.openclaw-${name}`),
    });
  }

  return profiles;
}

/**
 * Title-case a string.
 */
function titleCase(s: string): string {
  return s
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Get all discovered profiles (cached for 30 seconds).
 */
export async function getProfiles(): Promise<Profile[]> {
  if (cache && Date.now() < cache.expiry) {
    return cache.profiles;
  }

  let profiles = await discoverFromSystemd();

  // Fallback to env var if no systemd services found
  if (profiles.length === 0) {
    const envProfiles = discoverFromEnv();
    // Probe each env-sourced profile
    for (const profile of envProfiles) {
      const isOnline = await probeGateway(profile.gatewayUrl);
      profile.status = isOnline ? "online" : "offline";
    }
    profiles = envProfiles;
  }

  // Sort: default first, then alphabetically
  profiles.sort((a, b) => {
    if (a.id === "default") return -1;
    if (b.id === "default") return 1;
    return a.id.localeCompare(b.id);
  });

  cache = { profiles, expiry: Date.now() + CACHE_TTL_MS };
  return profiles;
}

/**
 * Get a single profile by ID.
 */
export async function getProfile(id: string): Promise<Profile | null> {
  const profiles = await getProfiles();
  return profiles.find((p) => p.id === id) || null;
}

/**
 * Clear the cache (for testing or forced refresh).
 */
export function clearProfileCache(): void {
  cache = null;
}
