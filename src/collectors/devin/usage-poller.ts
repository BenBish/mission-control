/**
 * Poll the Devin CLI's own plan-status endpoint and map PlanStatus to
 * quota_snapshot events. Credentials are read from
 * ~/.local/share/devin/credentials.toml — the API key is never logged or
 * embedded in events.
 *
 * The Devin CLI gets plan capacity from
 * SeatManagementService/GetUserStatus on api_server_url (Connect-RPC).
 * Its PlanStatus carries acu_consumed/acu_limit,
 * daily_quota_remaining_percent, weekly_quota_remaining_percent, and the
 * matching reset timestamps. Session JSONL/SQLite has no token usage at
 * all — this endpoint is the only known source of plan capacity.
 *
 * Request contract (verified against a live response): the server rejects
 * a bare `{}` body with 400 invalid_argument — it requires a `metadata`
 * field carrying `api_key`, `request_id` (uint64), `ide_name`,
 * `ide_version`, and `extension_version`. `extension_version` is parsed
 * server-side and must look like a version (non-version strings 500) —
 * the installed CLI version is read from cli/_versions/current when
 * available. Calls are still made defensively: soft failures return []
 * rather than inventing numbers.
 */

import fs from "fs";
import path from "path";
import {
  PLAN_WINDOW_MONTH_MINUTES,
  PLAN_WINDOW_WEEKLY_MINUTES,
} from "../../lib/plan-windows.js";
import {
  DEFAULT_DEVIN_API_SERVER,
  DEFAULT_DEVIN_CREDENTIALS_PATH,
  resolveDevinCredentials,
} from "../../services/provider-connectors/credentials.js";
import type { IngestEvent } from "../../types/ingest.js";

export { DEFAULT_DEVIN_API_SERVER, DEFAULT_DEVIN_CREDENTIALS_PATH };
export const DEVIN_USAGE_POLL_INTERVAL_MS = 15 * 60 * 1000;
export const DEVIN_USAGE_FETCH_TIMEOUT_MS = 15_000;

/**
 * Installed Devin CLI version — `~/.local/share/devin/cli/_versions/current`
 * is a symlink into a directory named after the version. Derived from the
 * credentials path so MC_DEVIN_CREDENTIALS_PATH overrides stay consistent.
 * Falls back to a plausible constant — the server only requires that
 * extension_version parses as a version.
 */
export function resolveDevinCliVersion(
  credentialsPath: string = DEFAULT_DEVIN_CREDENTIALS_PATH,
): string {
  try {
    const current = path.join(
      path.dirname(credentialsPath),
      "cli",
      "_versions",
      "current",
    );
    const target = fs.readlinkSync(current);
    const version = path.basename(target);
    if (/^\d+\.\d+\.\d+/.test(version)) return version;
  } catch {
    // no CLI install — fall through to the constant
  }
  return "0.1.0";
}

export function devinUserStatusUrl(
  base: string = DEFAULT_DEVIN_API_SERVER,
): string {
  return `${base.replace(/\/$/, "")}/exa.seat_management_pb.SeatManagementService/GetUserStatus`;
}

type FetchImpl = typeof fetch;

export async function fetchDevinUserStatus(
  apiKey: string,
  fetchImpl: FetchImpl = fetch,
  url: string = devinUserStatusUrl(),
  cliVersion: string = resolveDevinCliVersion(),
): Promise<unknown> {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Connect-Protocol-Version": "1",
      Accept: "application/json",
      "User-Agent": "mission-control-devin-collector",
    },
    body: JSON.stringify({
      metadata: {
        api_key: apiKey,
        request_id: String(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)),
        ide_name: "devin",
        ide_version: cliVersion,
        extension_version: cliVersion,
        os_name: process.platform,
      },
    }),
    signal: AbortSignal.timeout(DEVIN_USAGE_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    const err = new Error(
      `Devin GetUserStatus request failed with status ${res.status}`,
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

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Normalize epoch seconds/ms or ISO → ISO string. */
function normalizeUnixReset(value: unknown): string | undefined {
  const n = asFiniteNumber(value);
  if (n == null) {
    if (typeof value === "string" && value.trim()) {
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
    }
    return undefined;
  }
  const ms = n < 1e12 ? n * 1000 : n;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** Find the PlanStatus object inside a GetUserStatus response. */
function planStatusRoot(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  const candidates = [
    root.planStatus,
    root.plan_status,
    (root.userStatus as Record<string, unknown> | undefined)?.planInfo,
    (root.user_status as Record<string, unknown> | undefined)?.plan_info,
    (root.userStatus as Record<string, unknown> | undefined)?.planStatus,
    root,
  ];
  for (const c of candidates) {
    if (!c || typeof c !== "object") continue;
    const rec = c as Record<string, unknown>;
    if (
      rec.acuConsumed !== undefined ||
      rec.acu_consumed !== undefined ||
      rec.dailyQuotaRemainingPercent !== undefined ||
      rec.daily_quota_remaining_percent !== undefined ||
      rec.weeklyQuotaRemainingPercent !== undefined ||
      rec.weekly_quota_remaining_percent !== undefined
    ) {
      return rec;
    }
  }
  return null;
}

function pick(rec: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (rec[k] !== undefined && rec[k] !== null) return rec[k];
  }
  return undefined;
}

/**
 * Map GetUserStatus PlanStatus → quota_snapshot ingest events.
 * Pure; returns [] on unrecognized shape — never throws, never invents %.
 */
export function mapDevinPlanToQuotaEvents(
  payload: unknown,
  now: Date | string = new Date(),
): IngestEvent[] {
  const plan = planStatusRoot(payload);
  if (!plan) return [];
  const nowDate = typeof now === "string" ? new Date(now) : now;
  if (Number.isNaN(nowDate.getTime())) return [];
  const timestamp = nowDate.toISOString();

  const events: IngestEvent[] = [];

  const dailyRemaining = asFiniteNumber(
    pick(plan, "dailyQuotaRemainingPercent", "daily_quota_remaining_percent"),
  );
  if (dailyRemaining != null) {
    events.push({
      kind: "quota_snapshot",
      naturalKey: `devin-plan:devin:daily:${timestamp}`,
      payload: {
        timestamp,
        limitId: "devin:daily",
        usedPercent: clampPercent(100 - dailyRemaining),
        windowMinutes: 1_440,
        resetsAt: normalizeUnixReset(
          pick(plan, "dailyQuotaResetAtUnix", "daily_quota_reset_at_unix"),
        ),
      },
    });
  }

  const weeklyRemaining = asFiniteNumber(
    pick(plan, "weeklyQuotaRemainingPercent", "weekly_quota_remaining_percent"),
  );
  if (weeklyRemaining != null) {
    events.push({
      kind: "quota_snapshot",
      naturalKey: `devin-plan:devin:weekly:${timestamp}`,
      payload: {
        timestamp,
        limitId: "devin:weekly",
        usedPercent: clampPercent(100 - weeklyRemaining),
        windowMinutes: PLAN_WINDOW_WEEKLY_MINUTES,
        resetsAt: normalizeUnixReset(
          pick(plan, "weeklyQuotaResetAtUnix", "weekly_quota_reset_at_unix"),
        ),
      },
    });
  }

  const acuConsumed = asFiniteNumber(pick(plan, "acuConsumed", "acu_consumed"));
  const acuLimit = asFiniteNumber(pick(plan, "acuLimit", "acu_limit"));
  if (acuConsumed != null && acuLimit != null && acuLimit > 0) {
    events.push({
      kind: "quota_snapshot",
      naturalKey: `devin-plan:devin:acu:${timestamp}`,
      payload: {
        timestamp,
        limitId: "devin:acu",
        usedPercent: clampPercent((acuConsumed / acuLimit) * 100),
        windowMinutes: PLAN_WINDOW_MONTH_MINUTES,
        resetsAt: normalizeUnixReset(pick(plan, "planEnd", "plan_end")),
      },
    });
  }

  return events;
}

export interface PollDevinUsageOptions {
  credentialsPath?: string;
  now?: Date;
  fetchImpl?: FetchImpl;
  statusUrl?: string;
  onWarn?: (message: string) => void;
}

/**
 * Read credentials + fetch + map. Returns [] when credentials are missing
 * or on soft failures (endpoint contract drift, auth, network). Never
 * logs the API key.
 */
export async function pollDevinUsageEvents(
  opts: PollDevinUsageOptions = {},
): Promise<IngestEvent[]> {
  const now = opts.now ?? new Date();
  const warn = opts.onWarn ?? ((m: string) => console.warn(`[devin] ${m}`));
  const cred = resolveDevinCredentials(opts.credentialsPath);
  if (!cred) return [];

  try {
    const payload = await fetchDevinUserStatus(
      cred.apiKey,
      opts.fetchImpl,
      opts.statusUrl ?? devinUserStatusUrl(cred.apiServerUrl),
      resolveDevinCliVersion(opts.credentialsPath),
    );
    const events = mapDevinPlanToQuotaEvents(payload, now);
    if (events.length === 0) {
      warn("GetUserStatus returned no recognizable plan fields");
    }
    return events;
  } catch (err) {
    const status =
      err && typeof err === "object" && "status" in err
        ? Number((err as { status?: number }).status)
        : undefined;
    if (status === 401 || status === 403) {
      warn(
        `GetUserStatus unauthorized (${status}); skipping until credentials are refreshed`,
      );
      return [];
    }
    warn(
      `GetUserStatus poll failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
}
