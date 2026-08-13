/**
 * Normalize provider credit/balance payloads into CreditSnapshot rows.
 * Pure functions — no I/O. Never invent dollar amounts when fields are missing.
 *
 * BSH-93 surfaces:
 * - plan_usage: subscription / rate-limit windows (% remaining)
 * - wallet: prepaid usage credits (USD)
 * API org spend is NOT represented here (provider_usage_daily).
 */

import type {
  CapacitySurface,
  CreditFetchResult,
  CreditSnapshot,
  ProviderId,
} from "../types.js";

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Classify a snapshot for API/UI grouping (BSH-93). */
export function capacitySurfaceOf(snap: {
  surface?: CapacitySurface;
  source?: string;
  unit?: string;
  label?: string;
}): CapacitySurface {
  if (snap.surface === "plan_usage" || snap.surface === "wallet") {
    return snap.surface;
  }
  if (
    snap.source === "session_quota" ||
    snap.unit === "percent" ||
    (typeof snap.label === "string" && snap.label.startsWith("quota_"))
  ) {
    return "plan_usage";
  }
  return "wallet";
}

/**
 * OpenRouter official remaining credits (management key).
 * GET /api/v1/credits → { data: { total_credits, total_usage } }
 * Remaining ≈ total_credits − total_usage (USD credit units).
 */
export function normalizeOpenRouterCredits(
  payload: unknown,
  asOf: string = new Date().toISOString(),
): CreditSnapshot[] {
  if (!payload || typeof payload !== "object") return [];
  const root = payload as Record<string, unknown>;
  const data =
    root.data && typeof root.data === "object"
      ? (root.data as Record<string, unknown>)
      : root;

  const totalCredits = asNumber(data.total_credits);
  const totalUsage = asNumber(data.total_usage);
  if (totalCredits == null && totalUsage == null) return [];

  let remaining: number | null = null;
  if (totalCredits != null && totalUsage != null) {
    remaining = Math.max(0, totalCredits - totalUsage);
  } else if (totalCredits != null) {
    remaining = totalCredits;
  }

  return [
    {
      provider: "openrouter",
      asOf,
      remaining,
      total: totalCredits,
      unit: "usd",
      label: "prepaid_balance",
      source: "provider_api",
      status: "ok",
      surface: "wallet",
      details: {
        endpoint: "/api/v1/credits",
        totalCredits,
        totalUsage,
        note: "OpenRouter account credit wallet (not a subscription plan window).",
      },
    },
  ];
}

/**
 * Anthropic Admin API has no documented remaining-balance endpoint
 * (usage + cost history only). Record an explicit unavailable wallet snapshot.
 * Plan usage (Pro/Claude Code) is also unavailable via Admin — separate note.
 */
export function anthropicCreditsUnavailable(
  asOf: string = new Date().toISOString(),
  limitation?: string,
): CreditFetchResult {
  const message =
    limitation ??
    "Usage credit wallet is not exposed on Anthropic Admin Usage & Cost APIs.";
  return {
    snapshots: [
      {
        provider: "anthropic",
        asOf,
        remaining: null,
        total: null,
        unit: "usd",
        label: "prepaid_balance",
        source: "unavailable",
        status: "unavailable",
        surface: "wallet",
        details: {
          officialApis: [
            "/v1/organizations/usage_report/messages",
            "/v1/organizations/cost_report",
          ],
          note: message,
          planUsageNote:
            "Claude Pro / Claude Code plan limits are not available via Admin API. When the desktop collector is running, plan windows come from the Claude Code OAuth usage endpoint (~/.claude/.credentials.json).",
        },
      },
      {
        provider: "anthropic",
        asOf,
        remaining: null,
        total: null,
        unit: "percent",
        label: "plan_usage_unavailable",
        source: "unavailable",
        status: "unavailable",
        surface: "plan_usage",
        details: {
          note: "Claude Pro / Claude Code plan limits are not available via Admin API. When the desktop collector is running, plan windows come from the Claude Code OAuth usage endpoint (~/.claude/.credentials.json).",
        },
      },
    ],
    limitation: message,
  };
}

/**
 * OpenAI prepaid wallet is not available with secret/Admin keys
 * (dashboard credit_grants requires a browser session key — BSH-94).
 * Do not call the undocumented endpoint with secret keys.
 */
export function openaiWalletUnavailable(
  asOf: string = new Date().toISOString(),
): CreditFetchResult {
  const message =
    "OpenAI prepaid usage-credit wallet is not available via Admin/secret API keys (dashboard credit_grants requires a browser session key). Codex usage windows are separate (plan usage).";
  return {
    snapshots: [
      {
        provider: "openai",
        asOf,
        remaining: null,
        total: null,
        unit: "usd",
        label: "prepaid_balance",
        source: "unavailable",
        status: "unavailable",
        surface: "wallet",
        details: {
          note: message,
          endpoint: "dashboard/billing/credit_grants",
          keyType: "session_required",
        },
      },
    ],
    limitation: message,
  };
}

/**
 * xAI: no public credits API. Record limited/unavailable explicitly.
 */
export function xaiCreditsLimited(
  asOf: string = new Date().toISOString(),
): CreditFetchResult {
  const walletMessage =
    "xAI has no public prepaid balance/credits API; remaining capacity is not available programmatically.";
  const planMessage =
    "Grok SuperGrok plan windows are not available via XAI_API_KEY. When the desktop collector is running, they come from the Grok CLI billing endpoint (~/.grok/auth.json).";
  return {
    snapshots: [
      {
        provider: "xai",
        asOf,
        remaining: null,
        total: null,
        unit: "usd",
        label: "prepaid_balance",
        source: "unavailable",
        status: "limited",
        surface: "wallet",
        details: { note: walletMessage },
      },
      {
        provider: "xai",
        asOf,
        remaining: null,
        total: null,
        unit: "percent",
        label: "plan_usage_unavailable",
        source: "unavailable",
        status: "unavailable",
        surface: "plan_usage",
        details: { note: planMessage },
      },
    ],
    limitation: walletMessage,
  };
}

function sessionQuotaProductLanguage(provider: ProviderId): string {
  if (provider === "anthropic") {
    return "Claude Code plan-usage window (subscription rate limit), not prepaid USD credits.";
  }
  if (provider === "openai") {
    return "Codex/OpenAI usage window (rate-limit quota), not prepaid USD credits.";
  }
  if (provider === "xai") {
    return "Grok SuperGrok / Grok Build plan-usage window (subscription rate limit), not prepaid USD credits.";
  }
  return "Session quota / plan-usage window (rate-limit), not prepaid USD credits.";
}

/**
 * Map session quota_snapshot rows into plan-usage windows (not wallet).
 * used_percent remaining is expressed as percent remaining (100 - used).
 */
export function normalizeSessionQuotaToCredits(
  rows: Array<{
    source_id: string;
    instance_id: string;
    timestamp: string;
    limit_id: string;
    used_percent: number;
    window_minutes: number | null;
    resets_at: string | null;
  }>,
  provider: ProviderId = "openai",
): CreditSnapshot[] {
  const productLanguage = sessionQuotaProductLanguage(provider);
  return rows.map((r) => {
    const used = Number.isFinite(r.used_percent) ? r.used_percent : 0;
    const remainingPct = Math.max(0, Math.min(100, 100 - used));
    const windowLabel =
      r.window_minutes != null
        ? `quota_${r.limit_id}_${r.window_minutes}m`
        : `quota_${r.limit_id}`;
    return {
      provider,
      asOf: r.timestamp,
      remaining: remainingPct,
      total: 100,
      unit: "percent" as const,
      label: windowLabel.slice(0, 120),
      source: "session_quota" as const,
      status: "ok" as const,
      surface: "plan_usage" as const,
      details: {
        sourceId: r.source_id,
        instanceId: r.instance_id,
        limitId: r.limit_id,
        usedPercent: used,
        windowMinutes: r.window_minutes,
        resetsAt: r.resets_at,
        productLanguage,
      },
    };
  });
}
