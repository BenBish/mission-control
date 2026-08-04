/**
 * Normalize provider credit/balance payloads into CreditSnapshot rows.
 * Pure functions — no I/O. Never invent dollar amounts when fields are missing.
 */

import type {
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

/**
 * OpenAI undocumented dashboard credit_grants response shapes vary.
 * Accept common fields: total_granted, total_used, total_available,
 * or data[] grants with grant_amount / used_amount / available.
 * Amounts may be dollars or cents — prefer explicit total_available when present.
 */
export function normalizeOpenAICreditGrants(
  payload: unknown,
  asOf: string = new Date().toISOString(),
): CreditSnapshot[] {
  if (!payload || typeof payload !== "object") return [];
  const root = payload as Record<string, unknown>;

  let remaining = asNumber(root.total_available);
  let total = asNumber(root.total_granted);
  const used = asNumber(root.total_used);

  // Nested data array of grants
  if (remaining == null && Array.isArray(root.data)) {
    let grantSum = 0;
    let availSum = 0;
    let usedSum = 0;
    let sawAvail = false;
    for (const g of root.data) {
      if (!g || typeof g !== "object") continue;
      const row = g as Record<string, unknown>;
      const grant =
        asNumber(row.grant_amount) ??
        asNumber(row.amount) ??
        asNumber(row.granted);
      const avail =
        asNumber(row.available_amount) ??
        asNumber(row.available) ??
        asNumber(row.remaining);
      const u = asNumber(row.used_amount) ?? asNumber(row.used);
      if (grant != null) grantSum += grant;
      if (avail != null) {
        availSum += avail;
        sawAvail = true;
      }
      if (u != null) usedSum += u;
    }
    if (sawAvail) remaining = availSum;
    else if (grantSum > 0 && usedSum >= 0)
      remaining = Math.max(0, grantSum - usedSum);
    if (grantSum > 0) total = grantSum;
  }

  // Cents → dollars heuristic: values look like integer cents when large and
  // total_available_in_usd / similar is absent. Prefer dollar fields when present.
  const remainingUsd = asNumber(root.total_available_in_usd);
  const totalUsd = asNumber(root.total_granted_in_usd);
  if (remainingUsd != null) remaining = remainingUsd;
  if (totalUsd != null) total = totalUsd;

  if (remaining == null && total != null && used != null) {
    remaining = Math.max(0, total - used);
  }

  if (remaining == null && total == null) return [];

  return [
    {
      provider: "openai",
      asOf,
      remaining,
      total,
      unit: "usd",
      label: "prepaid_balance",
      source: "provider_api",
      status: "ok",
      details: {
        endpoint: "dashboard/billing/credit_grants",
        note: "Undocumented OpenAI dashboard endpoint; amounts treated as USD when not labeled as cents.",
      },
    },
  ];
}

/**
 * Anthropic Admin API has no documented remaining-balance endpoint
 * (usage + cost history only). Record an explicit unavailable snapshot.
 */
export function anthropicCreditsUnavailable(
  asOf: string = new Date().toISOString(),
  limitation?: string,
): CreditFetchResult {
  const message =
    limitation ??
    "Anthropic Admin API exposes usage_report and cost_report only — no documented remaining credit/balance endpoint.";
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
        details: {
          officialApis: [
            "/v1/organizations/usage_report/messages",
            "/v1/organizations/cost_report",
          ],
          note: message,
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
  const message =
    "xAI has no public prepaid balance/credits API; remaining capacity is not available programmatically.";
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
        details: { note: message },
      },
    ],
    limitation: message,
  };
}

/**
 * Map Codex/session quota_snapshot rows into credit-style capacity windows.
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
      details: {
        sourceId: r.source_id,
        instanceId: r.instance_id,
        limitId: r.limit_id,
        usedPercent: used,
        windowMinutes: r.window_minutes,
        resetsAt: r.resets_at,
        productLanguage:
          "Codex/OpenAI usage window (rate-limit quota), not prepaid USD credits.",
      },
    };
  });
}
