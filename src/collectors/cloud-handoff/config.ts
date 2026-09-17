/**
 * Cloud Handoff credentials. `handoff setup` writes
 * ~/.config/cloud-handoff/config as JSON ({url, token}, mode 0600);
 * CLOUD_HANDOFF_URL / CLOUD_HANDOFF_TOKEN env vars win over the file, matching
 * the handoff skill's own precedence. The token is never logged or embedded in
 * emitted events.
 */

import fs from "fs";
import os from "os";
import path from "path";

export const DEFAULT_CLOUD_HANDOFF_CONFIG_PATH = path.join(
  os.homedir(),
  ".config",
  "cloud-handoff",
  "config",
);

export interface CloudHandoffConfig {
  /** Control plane base URL, no trailing slash. */
  url: string;
  token: string;
}

export function readCloudHandoffConfig(
  configPath: string = DEFAULT_CLOUD_HANDOFF_CONFIG_PATH,
  env: Record<string, string | undefined> = process.env,
): CloudHandoffConfig | null {
  const envUrl = env.CLOUD_HANDOFF_URL?.trim();
  const envToken = env.CLOUD_HANDOFF_TOKEN?.trim();

  let fileUrl: string | undefined;
  let fileToken: string | undefined;
  if (!envUrl || !envToken) {
    try {
      const raw = fs.readFileSync(configPath, "utf8");
      const data = JSON.parse(raw) as unknown;
      if (data && typeof data === "object" && !Array.isArray(data)) {
        const rec = data as Record<string, unknown>;
        if (typeof rec.url === "string") fileUrl = rec.url.trim();
        if (typeof rec.token === "string") fileToken = rec.token.trim();
      }
    } catch {
      // Missing/unparseable config — treated as "not configured" below.
    }
  }

  const url = envUrl || fileUrl;
  const token = envToken || fileToken;
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ""), token };
}
