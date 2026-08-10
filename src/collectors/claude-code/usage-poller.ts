/**
 * Poll Claude Code OAuth usage endpoint and map windows to quota_snapshot events.
 * Token is read from ~/.claude/.credentials.json — never logged or embedded in events.
 */

import fs from "fs";
import os from "os";
import path from "path";
import type { IngestEvent } from "../../types/ingest.js";

export const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
export const CLAUDE_OAUTH_BETA = "oauth-2025-04-20";
export const DEFAULT_CLAUDE_CREDENTIALS_PATH = path.join(
  os.homedir(),
  ".claude",
  ".credentials.json",
);

/** Poll interval for OAuth usage (ms). Collector tick is 30s; we gate at 5 min. */
export const CLAUDE_USAGE_POLL_INTERVAL_MS = 5 * 60 * 1000;

export interface ClaudeOAuthToken {
  accessToken: string;
  /** Epoch ms when the access token expires, if known. */
  expiresAt: number | null;
}

type FetchImpl = typeof fetch;

const WINDOW_MAP: Array<{
  key: string;
  limitId: string;
  windowMinutes: number;
}> = [
  { key: "five_hour", limitId: "claude:5h", windowMinutes: 300 },
  { key: "seven_day", limitId: "claude:7d", windowMinutes: 10080 },
  { key: "seven_day_opus", limitId: "claude:7d_opus", windowMinutes: 10080 },
];

/**
 * Read Claude Code OAuth access token from credentials JSON.
 * Returns null on missing file / parse error / missing token. Never logs the token.
 */
export function readClaudeOAuthToken(
  credPath: string = DEFAULT_CLAUDE_CREDENTIALS_PATH,
): ClaudeOAuthToken | null {
  try {
    if (!fs.existsSync(credPath)) return null;
    const raw = fs.readFileSync(credPath, "utf8");
    const data = JSON.parse(raw) as Record<string, unknown>;
    const oauth = data.claudeAiOauth;
    if (!oauth || typeof oauth !== "object") return null;
    const rec = oauth as Record<string, unknown>;
    const accessToken =
      typeof rec.accessToken === "string" ? rec.accessToken : null;
    if (!accessToken) return null;
    let expiresAt: number | null = null;
    if (typeof rec.expiresAt === "number" && Number.isFinite(rec.expiresAt)) {
      expiresAt = rec.expiresAt;
    } else if (typeof rec.expiresAt === "string" && rec.expiresAt.trim()) {
      const n = Number(rec.expiresAt);
      if (Number.isFinite(n)) expiresAt = n;
    }
    return { accessToken, expiresAt };
  } catch {
    return null;
  }
}

/**
 * Fetch raw usage JSON from Anthropic OAuth usage endpoint.
 * Throws on non-2xx without echoing the token.
 */
export async function fetchClaudeUsage(
  token: string,
  fetchImpl: FetchImpl = fetch,
): Promise<unknown> {
  const res = await fetchImpl(CLAUDE_USAGE_URL, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "anthropic-beta": CLAUDE_OAUTH_BETA,
      "User-Agent": "mission-control-claude-code-collector",
    },
  });
  if (!res.ok) {
    const err = new Error(
      `Claude OAuth usage request failed with status ${res.status}`,
    ) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

/**
 * Normalize resets_at from epoch-seconds, epoch-ms, or ISO string → ISO string.
 * Returns undefined when unparseable.
 */
export function normalizeResetsAt(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "number" && Number.isFinite(value)) {
    // Heuristic: < 1e12 → seconds, else ms
    const ms = value < 1e12 ? value * 1000 : value;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const asNum = Number(value);
    if (Number.isFinite(asNum) && value.trim() !== "") {
      // Pure numeric string
      if (/^\d+(\.\d+)?$/.test(value.trim())) {
        return normalizeResetsAt(asNum);
      }
    }
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  return undefined;
}

function windowUtilization(
  payload: Record<string, unknown>,
  key: string,
): { usedPercent: number; resetsAt?: string } | null {
  const w = payload[key];
  if (!w || typeof w !== "object") return null;
  const rec = w as Record<string, unknown>;
  const util = rec.utilization;
  if (typeof util !== "number" || !Number.isFinite(util)) return null;
  return {
    usedPercent: clampPercent(util),
    resetsAt: normalizeResetsAt(rec.resets_at),
  };
}

/**
 * Map Claude OAuth usage payload → quota_snapshot ingest events.
 * Pure; returns [] on unrecognized shape — never throws.
 */
export function mapClaudeUsageToQuotaEvents(
  payload: unknown,
  now: Date | string = new Date(),
): IngestEvent[] {
  if (!payload || typeof payload !== "object") return [];
  const root = payload as Record<string, unknown>;
  const nowDate = typeof now === "string" ? new Date(now) : now;
  if (Number.isNaN(nowDate.getTime())) return [];
  const timestamp = nowDate.toISOString();
  const nowKey = timestamp;

  const events: IngestEvent[] = [];
  for (const { key, limitId, windowMinutes } of WINDOW_MAP) {
    const w = windowUtilization(root, key);
    if (!w) continue;
    events.push({
      kind: "quota_snapshot",
      naturalKey: `claude-oauth-usage:${limitId}:${nowKey}`,
      payload: {
        timestamp,
        limitId,
        usedPercent: w.usedPercent,
        windowMinutes,
        resetsAt: w.resetsAt,
      },
    });
  }
  return events;
}

export interface PollClaudeUsageOptions {
  credPath?: string;
  now?: Date;
  fetchImpl?: FetchImpl;
  /** Called for non-fatal diagnostics (never include token). */
  onWarn?: (message: string) => void;
}

/**
 * Read credentials + fetch + map. Returns [] when credentials missing/expired
 * or on soft failures. Rethrows only if caller wants — this helper swallows
 * network errors and returns [].
 */
export async function pollClaudeUsageEvents(
  opts: PollClaudeUsageOptions = {},
): Promise<IngestEvent[]> {
  const now = opts.now ?? new Date();
  const warn =
    opts.onWarn ?? ((m: string) => console.warn(`[claude-code] ${m}`));
  const cred = readClaudeOAuthToken(opts.credPath);
  if (!cred) return [];
  if (cred.expiresAt != null && cred.expiresAt <= now.getTime()) {
    // Do not refresh — Claude Code refreshes on next interactive run.
    return [];
  }

  try {
    const payload = await fetchClaudeUsage(cred.accessToken, opts.fetchImpl);
    return mapClaudeUsageToQuotaEvents(payload, now);
  } catch (err) {
    const status =
      err && typeof err === "object" && "status" in err
        ? Number((err as { status?: number }).status)
        : undefined;
    if (status === 401 || status === 403) {
      // Treat as expired / unauthorized — skip silently this cycle.
      warn(
        `OAuth usage unauthorized (${status}); skipping until Claude Code refreshes token`,
      );
      return [];
    }
    warn(
      `OAuth usage poll failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
}
