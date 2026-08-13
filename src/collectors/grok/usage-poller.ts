/**
 * Poll Grok CLI billing endpoint and map SuperGrok plan windows to
 * quota_snapshot events. Token is read from ~/.grok/auth.json — never logged
 * or embedded in events.
 *
 * Session JSONL only has token usage; plan remaining % comes from the same
 * `/billing?format=credits` JSON the Grok CLI `/usage` command uses.
 * prepaidBalance / onDemand* are wallet fields and are never emitted here.
 */

import fs from "fs";
import os from "os";
import path from "path";
import type { IngestEvent } from "../../types/ingest.js";

export const DEFAULT_GROK_AUTH_PATH = path.join(
  os.homedir(),
  ".grok",
  "auth.json",
);
export const DEFAULT_GROK_BILLING_BASE = "https://cli-chat-proxy.grok.com/v1";
export const GROK_USAGE_POLL_INTERVAL_MS = 5 * 60 * 1000;
export const GROK_USAGE_FETCH_TIMEOUT_MS = 15_000;

export interface GrokAuthToken {
  accessToken: string;
  /** Epoch ms when the access token expires, if known. */
  expiresAt: number | null;
}

type FetchImpl = typeof fetch;

export function grokBillingUrl(
  base: string = process.env.GROK_CLI_CHAT_PROXY_BASE_URL?.trim() ||
    DEFAULT_GROK_BILLING_BASE,
): string {
  const trimmed = base.replace(/\/$/, "");
  return `${trimmed}/billing?format=credits`;
}

/**
 * Read Grok CLI OIDC/session access token from auth.json.
 * Returns null on missing file / parse error / missing token. Never logs the token.
 */
export function readGrokAuthToken(
  authPath: string = DEFAULT_GROK_AUTH_PATH,
): GrokAuthToken | null {
  try {
    if (!fs.existsSync(authPath)) return null;
    const raw = fs.readFileSync(authPath, "utf8");
    const data = JSON.parse(raw) as unknown;
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;

    const candidates: GrokAuthToken[] = [];
    for (const value of Object.values(data as Record<string, unknown>)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const rec = value as Record<string, unknown>;
      const accessToken = typeof rec.key === "string" ? rec.key : null;
      if (!accessToken) continue;
      candidates.push({
        accessToken,
        expiresAt: parseExpiresAtMs(rec.expires_at),
      });
    }
    if (candidates.length === 0) return null;
    // Prefer a token that is not already expired.
    const now = Date.now();
    const live = candidates.find(
      (c) => c.expiresAt == null || c.expiresAt > now,
    );
    return live ?? candidates[0];
  } catch {
    return null;
  }
}

function parseExpiresAtMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === "string" && value.trim()) {
    const asNum = Number(value);
    if (Number.isFinite(asNum) && /^\d+(\.\d+)?$/.test(value.trim())) {
      return asNum < 1e12 ? asNum * 1000 : asNum;
    }
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.getTime();
  }
  return null;
}

export async function fetchGrokBilling(
  token: string,
  fetchImpl: FetchImpl = fetch,
  url: string = grokBillingUrl(),
): Promise<unknown> {
  const res = await fetchImpl(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": "mission-control-grok-collector",
    },
    signal: AbortSignal.timeout(GROK_USAGE_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    const err = new Error(
      `Grok billing request failed with status ${res.status}`,
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

/** Normalize period end from ISO / epoch → ISO string. */
export function normalizeResetsAt(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value < 1e12 ? value * 1000 : value;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const asNum = Number(value);
    if (Number.isFinite(asNum) && /^\d+(\.\d+)?$/.test(value.trim())) {
      return normalizeResetsAt(asNum);
    }
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  return undefined;
}

export function windowFromPeriod(
  type: unknown,
  start: unknown,
  end: unknown,
): { limitId: string; windowMinutes?: number } {
  const startMs = start != null ? new Date(String(start)).getTime() : NaN;
  const endMs = end != null ? new Date(String(end)).getTime() : NaN;
  const computed =
    Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
      ? Math.round((endMs - startMs) / 60_000)
      : undefined;
  const t = typeof type === "string" ? type.toUpperCase() : "";

  if (
    t.includes("FIVE_HOUR") ||
    t.includes("5H") ||
    t.includes("5_HOUR") ||
    computed === 300
  ) {
    return { limitId: "grok:5h", windowMinutes: computed ?? 300 };
  }
  if (t.includes("WEEK") || t.includes("SEVEN_DAY") || computed === 10_080) {
    return { limitId: "grok:week", windowMinutes: computed ?? 10_080 };
  }
  if (
    t.includes("MONTH") ||
    (computed != null && computed >= 28 * 1440 && computed <= 31 * 1440)
  ) {
    return { limitId: "grok:month", windowMinutes: computed ?? 43_200 };
  }
  if ((t.includes("DAY") && !t.includes("WEEK")) || computed === 1440) {
    return { limitId: "grok:day", windowMinutes: computed ?? 1440 };
  }
  return computed != null && computed > 0
    ? { limitId: "grok:plan", windowMinutes: computed }
    : { limitId: "grok:plan" };
}

function billingRoot(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  if (root.config && typeof root.config === "object") {
    return root.config as Record<string, unknown>;
  }
  if (typeof root.creditUsagePercent === "number" || root.currentPeriod) {
    return root;
  }
  return null;
}

function productSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 32);
}

/**
 * Map Grok billing payload → quota_snapshot ingest events.
 * Pure; returns [] on unrecognized shape — never throws, never invents %.
 * Wallet fields (prepaidBalance, onDemand*) are ignored.
 */
export function mapGrokBillingToQuotaEvents(
  payload: unknown,
  now: Date | string = new Date(),
): IngestEvent[] {
  const cfg = billingRoot(payload);
  if (!cfg) return [];
  const nowDate = typeof now === "string" ? new Date(now) : now;
  if (Number.isNaN(nowDate.getTime())) return [];
  const timestamp = nowDate.toISOString();

  const used = asFiniteNumber(cfg.creditUsagePercent);
  if (used == null) return [];

  const period =
    cfg.currentPeriod && typeof cfg.currentPeriod === "object"
      ? (cfg.currentPeriod as Record<string, unknown>)
      : {};
  const { limitId, windowMinutes } = windowFromPeriod(
    period.type,
    period.start ?? cfg.billingPeriodStart,
    period.end ?? cfg.billingPeriodEnd,
  );
  const resetsAt = normalizeResetsAt(period.end ?? cfg.billingPeriodEnd);

  const events: IngestEvent[] = [
    {
      kind: "quota_snapshot",
      naturalKey: `grok-billing:${limitId}:${timestamp}`,
      payload: {
        timestamp,
        limitId,
        usedPercent: clampPercent(used),
        windowMinutes,
        resetsAt,
      },
    },
  ];

  // Extra per-product windows only when they add information beyond the
  // single current-period bar (mirrors Claude's optional Opus weekly).
  const products = Array.isArray(cfg.productUsage) ? cfg.productUsage : [];
  const extras = products.filter((p): p is Record<string, unknown> => {
    if (!p || typeof p !== "object") return false;
    const rec = p as Record<string, unknown>;
    const name = typeof rec.product === "string" ? rec.product.trim() : "";
    const pct = asFiniteNumber(rec.usagePercent);
    return Boolean(name) && pct != null;
  });
  const onlyMirrorsPeriod =
    extras.length === 1 && asFiniteNumber(extras[0].usagePercent) === used;
  if (!onlyMirrorsPeriod) {
    for (const rec of extras) {
      const slug = productSlug(String(rec.product));
      if (!slug) continue;
      const productLimit = `grok:${slug}`;
      if (productLimit === limitId) continue;
      const pct = asFiniteNumber(rec.usagePercent);
      if (pct == null) continue;
      events.push({
        kind: "quota_snapshot",
        naturalKey: `grok-billing:${productLimit}:${timestamp}`,
        payload: {
          timestamp,
          limitId: productLimit,
          usedPercent: clampPercent(pct),
          windowMinutes,
          resetsAt,
        },
      });
    }
  }

  return events;
}

export interface PollGrokUsageOptions {
  authPath?: string;
  now?: Date;
  fetchImpl?: FetchImpl;
  billingUrl?: string;
  onWarn?: (message: string) => void;
}

/**
 * Read credentials + fetch + map. Returns [] when credentials missing/expired
 * or on soft failures. Never logs the token.
 */
export async function pollGrokUsageEvents(
  opts: PollGrokUsageOptions = {},
): Promise<IngestEvent[]> {
  const now = opts.now ?? new Date();
  const warn = opts.onWarn ?? ((m: string) => console.warn(`[grok] ${m}`));
  const cred = readGrokAuthToken(opts.authPath);
  if (!cred) return [];
  if (cred.expiresAt != null && cred.expiresAt <= now.getTime()) {
    return [];
  }

  try {
    const payload = await fetchGrokBilling(
      cred.accessToken,
      opts.fetchImpl,
      opts.billingUrl ?? grokBillingUrl(),
    );
    return mapGrokBillingToQuotaEvents(payload, now);
  } catch (err) {
    const status =
      err && typeof err === "object" && "status" in err
        ? Number((err as { status?: number }).status)
        : undefined;
    if (status === 401 || status === 403) {
      warn(
        `billing unauthorized (${status}); skipping until Grok CLI refreshes token`,
      );
      return [];
    }
    warn(
      `billing poll failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
}
