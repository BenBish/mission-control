/**
 * Spend reconciliation (BSH-101).
 *
 * Links provider billing rows to agent session usage with explicit confidence.
 * Derived on read — never mutates raw provider or agent data.
 *
 * Matching rules: docs/spend-reconciliation.md
 */

import type { Database as SqliteDatabase } from "sqlite";
import {
  listAgentUsageDailyFacts,
  type AgentUsageDailyFactRow,
} from "../db/queries/agent-usage.js";
import {
  getProviderUsage,
  listProviderSyncStatus,
  type ProviderUsageRow,
  type ProviderSyncStatusRow,
} from "../db/queries/provider-usage.js";
import { toProviderDayKey } from "../lib/date-range.js";
import { normalizeModelIdentity } from "../lib/model-identity.js";
import { SYNC_STALE_MS } from "./provider-spend-insights.js";
import { getConnectors } from "./provider-connectors/index.js";

export const PROVIDER_IDS = [
  "openrouter",
  "anthropic",
  "openai",
  "xai",
] as const;

export type ReconciliationProviderId = (typeof PROVIDER_IDS)[number];

export type ByokTreatment =
  | "flag_overlap"
  | "exclude_openrouter"
  | "prefer_direct";

export type MatchClassification =
  | "exact"
  | "likely"
  | "ambiguous"
  | "duplicate_risk"
  | "unmatched_provider"
  | "unmatched_agent";

export type MatchRuleHit =
  | "exact_token_band"
  | "model_day_only"
  | "multi_provider"
  | "byok_overlap"
  | "provider_only"
  | "agent_only"
  | "unknown_or_synthetic_model";

/** Relative token band for exact matches (15%). */
export const EXACT_TOKEN_RATIO = 0.15;

const DIRECT_PROVIDERS = new Set<string>(["anthropic", "openai", "xai"]);

export type ProviderContribution = {
  provider: string;
  rawModels: string[];
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  requestCount: number;
  /** Latest updated_at among contributing rows (ISO-ish). */
  updatedAt: string | null;
};

export type AgentContribution = {
  sourceIds: string[];
  rawModels: string[];
  inputTokens: number;
  outputTokens: number;
  /** Session-log cost only — provenance session-log, not provider actual. */
  logCostUsd: number | null;
  hasLogCost: boolean;
  requestCount: number;
};

export type ReconciliationMatch = {
  key: string;
  day: string;
  canonicalModel: string;
  classification: MatchClassification;
  ruleHit: MatchRuleHit;
  /** 0–1 confidence score for UI (exact=1, likely=0.7, ambiguous=0.4, …). */
  confidence: number;
  tokenRatio: number | null;
  provider: ProviderContribution[];
  agent: AgentContribution | null;
  /** Provider cost attributed to this classification (sum of provider costs). */
  providerCostUsd: number;
  /** True when classification is exact or likely. */
  isMatched: boolean;
};

export type ReconciliationSummary = {
  providerSpendUsd: number;
  matchedSpendUsd: number;
  unmatchedProviderSpendUsd: number;
  ambiguousSpendUsd: number;
  duplicateRiskSpendUsd: number;
  /** Agent tokens on unmatched_agent keys. */
  agentTokensWithoutBilling: number;
  /** Session-log cost across all agent contributions (not provider actual). */
  agentLogCostUsd: number | null;
  hasAgentLogCost: boolean;
  /** matchedSpend / providerSpend * 100, or null when no provider spend. */
  coveragePct: number | null;
  matchCounts: Record<MatchClassification, number>;
};

export type ReconciliationReport = {
  range: { since: string | null; until: string | null };
  options: {
    includeProviders: ReconciliationProviderId[] | null;
    excludeProviders: ReconciliationProviderId[];
    byokTreatment: ByokTreatment;
  };
  summary: ReconciliationSummary;
  matches: ReconciliationMatch[];
  notes: string[];
  meta: {
    source: "derived-on-read";
    documentation: "docs/spend-reconciliation.md";
    exactTokenRatio: number;
    computedAt: string;
  };
};

export type ReconcileOptions = {
  includeProviders?: ReconciliationProviderId[] | null;
  excludeProviders?: ReconciliationProviderId[];
  byokTreatment?: ByokTreatment;
  /** ISO or day key lower bound (inclusive). */
  since?: string | null;
  until?: string | null;
  now?: Date;
};

function tokensOf(row: { inputTokens: number; outputTokens: number }): number {
  return row.inputTokens + row.outputTokens;
}

function costOf(c: number | null | undefined): number {
  return c != null && Number.isFinite(c) ? c : 0;
}

function tokenRatio(
  agentTokens: number,
  providerTokens: number,
): number | null {
  const denom = Math.max(agentTokens, providerTokens, 1);
  if (agentTokens === 0 && providerTokens === 0) return 0;
  return Math.abs(agentTokens - providerTokens) / denom;
}

function confidenceFor(c: MatchClassification): number {
  switch (c) {
    case "exact":
      return 1;
    case "likely":
      return 0.7;
    case "ambiguous":
      return 0.4;
    case "duplicate_risk":
      return 0.25;
    case "unmatched_provider":
    case "unmatched_agent":
      return 0;
  }
}

function isProviderId(p: string): p is ReconciliationProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(p);
}

function hasByokOverlap(providers: string[]): boolean {
  const set = new Set(providers);
  if (!set.has("openrouter")) return false;
  for (const d of DIRECT_PROVIDERS) {
    if (set.has(d)) return true;
  }
  return false;
}

type AggProvider = {
  day: string;
  canonicalModel: string;
  contributions: Map<string, ProviderContribution>;
};

type AggAgent = {
  day: string;
  canonicalModel: string;
  isUnknown: boolean;
  isSynthetic: boolean;
  contribution: AgentContribution;
};

function mergeProvider(
  map: Map<string, ProviderContribution>,
  row: ProviderUsageRow,
): void {
  const existing = map.get(row.provider);
  const rawModels = existing?.rawModels ? [...existing.rawModels] : [];
  if (row.model && !rawModels.includes(row.model)) rawModels.push(row.model);
  rawModels.sort();
  const updatedAt =
    row.updated_at &&
    (!existing?.updatedAt || row.updated_at > existing.updatedAt)
      ? row.updated_at
      : (existing?.updatedAt ?? row.updated_at ?? null);
  map.set(row.provider, {
    provider: row.provider,
    rawModels,
    inputTokens: (existing?.inputTokens ?? 0) + (row.input_tokens ?? 0),
    outputTokens: (existing?.outputTokens ?? 0) + (row.output_tokens ?? 0),
    costUsd:
      existing?.costUsd != null || row.cost_usd != null
        ? costOf(existing?.costUsd) + costOf(row.cost_usd)
        : null,
    requestCount: (existing?.requestCount ?? 0) + (row.request_count ?? 0),
    updatedAt,
  });
}

/**
 * Filter provider rows by include/exclude and BYOK treatment at the row level
 * for exclude_openrouter. prefer_direct is applied after grouping.
 */
export function filterProviderRows(
  rows: ProviderUsageRow[],
  opts: {
    includeProviders?: ReconciliationProviderId[] | null;
    excludeProviders?: ReconciliationProviderId[];
    byokTreatment?: ByokTreatment;
  },
): ProviderUsageRow[] {
  const include = opts.includeProviders?.length
    ? new Set(opts.includeProviders)
    : null;
  const exclude = new Set(opts.excludeProviders ?? []);
  const byok = opts.byokTreatment ?? "flag_overlap";

  return rows.filter((r) => {
    if (!isProviderId(r.provider)) return false;
    if (include && !include.has(r.provider)) return false;
    if (exclude.has(r.provider)) return false;
    if (byok === "exclude_openrouter" && r.provider === "openrouter") {
      return false;
    }
    return true;
  });
}

function aggregateProviders(
  rows: ProviderUsageRow[],
): Map<string, AggProvider> {
  const map = new Map<string, AggProvider>();
  for (const row of rows) {
    const id = normalizeModelIdentity(row.model);
    if (id.isSynthetic || id.isUnknown) {
      // Keep unknown provider models as their raw-normalized key so they can
      // still surface as unmatched_provider rather than vanishing.
    }
    const canonical = id.canonical;
    const key = `${row.day}|${canonical}`;
    let agg = map.get(key);
    if (!agg) {
      agg = {
        day: row.day,
        canonicalModel: canonical,
        contributions: new Map(),
      };
      map.set(key, agg);
    }
    mergeProvider(agg.contributions, row);
  }
  return map;
}

function aggregateAgents(
  rows: AgentUsageDailyFactRow[],
): Map<string, AggAgent> {
  const map = new Map<string, AggAgent>();
  for (const row of rows) {
    const id = normalizeModelIdentity(row.model);
    const day = row.day;
    const key = `${day}|${id.canonical}`;
    let agg = map.get(key);
    if (!agg) {
      agg = {
        day,
        canonicalModel: id.canonical,
        isUnknown: id.isUnknown,
        isSynthetic: id.isSynthetic,
        contribution: {
          sourceIds: [],
          rawModels: [],
          inputTokens: 0,
          outputTokens: 0,
          logCostUsd: null,
          hasLogCost: false,
          requestCount: 0,
        },
      };
      map.set(key, agg);
    }
    if (id.isUnknown) agg.isUnknown = true;
    if (id.isSynthetic) agg.isSynthetic = true;
    const c = agg.contribution;
    if (row.source_id && !c.sourceIds.includes(row.source_id)) {
      c.sourceIds.push(row.source_id);
    }
    if (row.model && !c.rawModels.includes(row.model)) {
      c.rawModels.push(row.model);
    }
    c.inputTokens += row.input_tokens ?? 0;
    c.outputTokens += row.output_tokens ?? 0;
    c.requestCount += row.request_count ?? 0;
    if (row.cost_usd != null) {
      c.logCostUsd = (c.logCostUsd ?? 0) + row.cost_usd;
      c.hasLogCost = true;
    }
  }
  for (const agg of map.values()) {
    agg.contribution.sourceIds.sort();
    agg.contribution.rawModels.sort();
  }
  return map;
}

/**
 * Apply prefer_direct: for keys with openrouter + direct, move openrouter to
 * a side bucket that will be classified duplicate_risk separately.
 */
function applyPreferDirect(providerMap: Map<string, AggProvider>): {
  primary: Map<string, AggProvider>;
  openrouterOnly: Map<string, ProviderContribution>;
} {
  const primary = new Map<string, AggProvider>();
  const openrouterOnly = new Map<string, ProviderContribution>();

  for (const [key, agg] of providerMap) {
    const providers = [...agg.contributions.keys()];
    if (hasByokOverlap(providers)) {
      const or = agg.contributions.get("openrouter");
      if (or) {
        openrouterOnly.set(key, or);
        const next = new Map(agg.contributions);
        next.delete("openrouter");
        primary.set(key, { ...agg, contributions: next });
        continue;
      }
    }
    primary.set(key, agg);
  }
  return { primary, openrouterOnly };
}

function providerCostSum(contribs: ProviderContribution[]): number {
  return contribs.reduce((s, c) => s + costOf(c.costUsd), 0);
}

function classifyPair(
  day: string,
  canonicalModel: string,
  providerContribs: ProviderContribution[],
  agent: AggAgent | null,
  byokTreatment: ByokTreatment,
): ReconciliationMatch {
  const key = `${day}|${canonicalModel}`;
  const providers = providerContribs.map((c) => c.provider);
  const providerCostUsd = providerCostSum(providerContribs);
  const providerTokens = providerContribs.reduce((s, c) => s + tokensOf(c), 0);

  // Provider only
  if (!agent) {
    return {
      key,
      day,
      canonicalModel,
      classification: "unmatched_provider",
      ruleHit: "provider_only",
      confidence: confidenceFor("unmatched_provider"),
      tokenRatio: null,
      provider: providerContribs,
      agent: null,
      providerCostUsd,
      isMatched: false,
    };
  }

  const agentTokens = tokensOf(agent.contribution);
  const ratio = tokenRatio(agentTokens, providerTokens);

  // Unknown/synthetic agent models never form clean matches; keep provider
  // spend visible as unmatched_provider when only garbage agent keys exist,
  // but we still attach agent evidence for drill-down.
  if (agent.isUnknown || agent.isSynthetic) {
    return {
      key,
      day,
      canonicalModel,
      classification: "unmatched_provider",
      ruleHit: "unknown_or_synthetic_model",
      confidence: confidenceFor("unmatched_provider"),
      tokenRatio: ratio,
      provider: providerContribs,
      agent: agent.contribution,
      providerCostUsd,
      isMatched: false,
    };
  }

  if (hasByokOverlap(providers) && byokTreatment === "flag_overlap") {
    return {
      key,
      day,
      canonicalModel,
      classification: "duplicate_risk",
      ruleHit: "byok_overlap",
      confidence: confidenceFor("duplicate_risk"),
      tokenRatio: ratio,
      provider: providerContribs,
      agent: agent.contribution,
      providerCostUsd,
      isMatched: false,
    };
  }

  if (providerContribs.length > 1) {
    return {
      key,
      day,
      canonicalModel,
      classification: "ambiguous",
      ruleHit: "multi_provider",
      confidence: confidenceFor("ambiguous"),
      tokenRatio: ratio,
      provider: providerContribs,
      agent: agent.contribution,
      providerCostUsd,
      isMatched: false,
    };
  }

  // Single provider + known agent model
  if (ratio != null && ratio <= EXACT_TOKEN_RATIO) {
    return {
      key,
      day,
      canonicalModel,
      classification: "exact",
      ruleHit: "exact_token_band",
      confidence: confidenceFor("exact"),
      tokenRatio: ratio,
      provider: providerContribs,
      agent: agent.contribution,
      providerCostUsd,
      isMatched: true,
    };
  }

  return {
    key,
    day,
    canonicalModel,
    classification: "likely",
    ruleHit: "model_day_only",
    confidence: confidenceFor("likely"),
    tokenRatio: ratio,
    provider: providerContribs,
    agent: agent.contribution,
    providerCostUsd,
    isMatched: true,
  };
}

function emptyMatchCounts(): Record<MatchClassification, number> {
  return {
    exact: 0,
    likely: 0,
    ambiguous: 0,
    duplicate_risk: 0,
    unmatched_provider: 0,
    unmatched_agent: 0,
  };
}

/**
 * Pure reconciliation from already-loaded rows.
 * Exported for unit tests — does not touch the database.
 */
export function buildReconciliationReport(
  providerRows: ProviderUsageRow[],
  agentRows: AgentUsageDailyFactRow[],
  opts: ReconcileOptions = {},
): ReconciliationReport {
  const byokTreatment = opts.byokTreatment ?? "flag_overlap";
  const includeProviders = opts.includeProviders?.length
    ? opts.includeProviders
    : null;
  const excludeProviders = opts.excludeProviders ?? [];
  const now = opts.now ?? new Date();

  const filtered = filterProviderRows(providerRows, {
    includeProviders,
    excludeProviders,
    byokTreatment,
  });

  let providerMap = aggregateProviders(filtered);
  let openrouterSide = new Map<string, ProviderContribution>();
  if (byokTreatment === "prefer_direct") {
    const applied = applyPreferDirect(providerMap);
    providerMap = applied.primary;
    openrouterSide = applied.openrouterOnly;
  }

  const agentMap = aggregateAgents(agentRows);
  const matches: ReconciliationMatch[] = [];
  const seenKeys = new Set<string>();

  // Keys with provider data
  for (const [key, agg] of providerMap) {
    seenKeys.add(key);
    const contribs = [...agg.contributions.values()].sort((a, b) =>
      a.provider.localeCompare(b.provider),
    );
    const agent = agentMap.get(key) ?? null;
    matches.push(
      classifyPair(agg.day, agg.canonicalModel, contribs, agent, byokTreatment),
    );
  }

  // OpenRouter side-car under prefer_direct → always duplicate_risk
  for (const [key, or] of openrouterSide) {
    const [day, canonicalModel] = key.split("|");
    const agent = agentMap.get(key) ?? null;
    matches.push({
      key: `${key}|openrouter-byok`,
      day,
      canonicalModel,
      classification: "duplicate_risk",
      ruleHit: "byok_overlap",
      confidence: confidenceFor("duplicate_risk"),
      tokenRatio: agent
        ? tokenRatio(tokensOf(agent.contribution), tokensOf(or))
        : null,
      provider: [or],
      agent: agent?.contribution ?? null,
      providerCostUsd: costOf(or.costUsd),
      isMatched: false,
    });
    seenKeys.add(key);
  }

  // Agent-only keys
  for (const [key, agent] of agentMap) {
    if (seenKeys.has(key)) continue;
    if (agent.isUnknown || agent.isSynthetic) {
      matches.push({
        key,
        day: agent.day,
        canonicalModel: agent.canonicalModel,
        classification: "unmatched_agent",
        ruleHit: "unknown_or_synthetic_model",
        confidence: confidenceFor("unmatched_agent"),
        tokenRatio: null,
        provider: [],
        agent: agent.contribution,
        providerCostUsd: 0,
        isMatched: false,
      });
      continue;
    }
    matches.push({
      key,
      day: agent.day,
      canonicalModel: agent.canonicalModel,
      classification: "unmatched_agent",
      ruleHit: "agent_only",
      confidence: confidenceFor("unmatched_agent"),
      tokenRatio: null,
      provider: [],
      agent: agent.contribution,
      providerCostUsd: 0,
      isMatched: false,
    });
  }

  matches.sort((a, b) => {
    if (a.day !== b.day) return b.day.localeCompare(a.day);
    return a.canonicalModel.localeCompare(b.canonicalModel);
  });

  const matchCounts = emptyMatchCounts();
  let providerSpendUsd = 0;
  let matchedSpendUsd = 0;
  let unmatchedProviderSpendUsd = 0;
  let ambiguousSpendUsd = 0;
  let duplicateRiskSpendUsd = 0;
  let agentTokensWithoutBilling = 0;
  let agentLogCostUsd: number | null = null;
  let hasAgentLogCost = false;

  for (const m of matches) {
    matchCounts[m.classification]++;
    providerSpendUsd += m.providerCostUsd;
    if (m.isMatched) matchedSpendUsd += m.providerCostUsd;
    if (m.classification === "unmatched_provider") {
      unmatchedProviderSpendUsd += m.providerCostUsd;
    }
    if (m.classification === "ambiguous") {
      ambiguousSpendUsd += m.providerCostUsd;
    }
    if (m.classification === "duplicate_risk") {
      duplicateRiskSpendUsd += m.providerCostUsd;
    }
    if (m.classification === "unmatched_agent" && m.agent) {
      agentTokensWithoutBilling += tokensOf(m.agent);
    }
    if (m.agent?.hasLogCost && m.agent.logCostUsd != null) {
      agentLogCostUsd = (agentLogCostUsd ?? 0) + m.agent.logCostUsd;
      hasAgentLogCost = true;
    }
  }

  const coveragePct =
    providerSpendUsd > 0
      ? Math.round((matchedSpendUsd / providerSpendUsd) * 1000) / 10
      : null;

  const notes = buildNotes(matches, filtered, now);

  return {
    range: {
      since: opts.since ?? null,
      until: opts.until ?? null,
    },
    options: {
      includeProviders,
      excludeProviders,
      byokTreatment,
    },
    summary: {
      providerSpendUsd,
      matchedSpendUsd,
      unmatchedProviderSpendUsd,
      ambiguousSpendUsd,
      duplicateRiskSpendUsd,
      agentTokensWithoutBilling,
      agentLogCostUsd,
      hasAgentLogCost,
      coveragePct,
      matchCounts,
    },
    matches,
    notes,
    meta: {
      source: "derived-on-read",
      documentation: "docs/spend-reconciliation.md",
      exactTokenRatio: EXACT_TOKEN_RATIO,
      computedAt: now.toISOString(),
    },
  };
}

function buildNotes(
  matches: ReconciliationMatch[],
  providerRows: ProviderUsageRow[],
  now: Date,
): string[] {
  const notes: string[] = [];
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  // Billing lag: provider updated_at far after day end
  let lagCount = 0;
  for (const row of providerRows) {
    if (!row.updated_at) continue;
    const dayEnd = new Date(`${row.day}T23:59:59.000Z`).getTime();
    const updated = new Date(row.updated_at).getTime();
    if (
      !Number.isNaN(dayEnd) &&
      !Number.isNaN(updated) &&
      updated - dayEnd > 36 * 60 * 60 * 1000
    ) {
      lagCount++;
    }
  }
  if (lagCount > 0) {
    notes.push(
      `${lagCount} provider billing row(s) finalized more than 36h after the billing day — late data can change matches when re-run.`,
    );
  }

  const recentAgentOnly = matches.filter(
    (m) =>
      m.classification === "unmatched_agent" &&
      (m.day === today || m.day === yesterday),
  );
  if (recentAgentOnly.length > 0) {
    notes.push(
      `Agent usage on ${recentAgentOnly.length} recent day/model key(s) has no provider billing yet — connectors may still deliver delayed cost rows.`,
    );
  }

  const dup = matches.filter((m) => m.classification === "duplicate_risk");
  if (dup.length > 0) {
    notes.push(
      `${dup.length} day/model key(s) show OpenRouter + direct provider overlap (BYOK risk). Totals are not summed; adjust BYOK treatment to exclude or prefer direct.`,
    );
  }

  notes.push(
    "Provider spend and agent usage are separate datasets — matched spend is attributed by rule, never a raw sum of both.",
  );

  return notes;
}

export function parseByokTreatment(
  raw: string | null | undefined,
): ByokTreatment {
  if (
    raw === "exclude_openrouter" ||
    raw === "prefer_direct" ||
    raw === "flag_overlap"
  ) {
    return raw;
  }
  return "flag_overlap";
}

export function parseProviderList(
  raw: string | null | undefined,
): ReconciliationProviderId[] | null {
  if (raw == null || raw.trim() === "") return null;
  const parts = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const out: ReconciliationProviderId[] = [];
  for (const p of parts) {
    if (isProviderId(p) && !out.includes(p)) out.push(p);
  }
  return out.length ? out : null;
}

/**
 * Load rows and build a reconciliation report (idempotent, derived on read).
 */
export async function getSpendReconciliation(
  db: SqliteDatabase,
  opts: ReconcileOptions & { sourceId?: string | null } = {},
): Promise<ReconciliationReport> {
  const since = opts.since ?? undefined;
  const until = opts.until ?? undefined;

  // Provider day filter: use day keys
  const providerSince = since ? toProviderDayKey(since) : undefined;
  let providerRows = await getProviderUsage(db, { since: providerSince });
  if (until) {
    const untilDay = toProviderDayKey(until);
    providerRows = providerRows.filter((r) => r.day <= untilDay);
  }

  // Agent timestamps are full ISO. If the client passed a YYYY-MM-DD day key
  // (provider semantics), expand to UTC midnight so the comparison is valid.
  const agentSince =
    since == null
      ? undefined
      : /^\d{4}-\d{2}-\d{2}$/.test(since)
        ? `${since}T00:00:00.000Z`
        : since;
  const agentUntil =
    until == null
      ? undefined
      : /^\d{4}-\d{2}-\d{2}$/.test(until)
        ? `${until}T23:59:59.999Z`
        : until;

  const agentRows = await listAgentUsageDailyFacts(db, {
    since: agentSince,
    until: agentUntil,
    sourceId: opts.sourceId ?? undefined,
  });

  const report = buildReconciliationReport(providerRows, agentRows, {
    ...opts,
    since: since ?? null,
    until: until ?? null,
  });

  // Enrich notes with connector health
  const syncStatus = await listProviderSyncStatus(db);
  const configured = new Set(getConnectors().map((c) => c.id));
  const nowMs = (opts.now ?? new Date()).getTime();
  const healthNotes = syncHealthNotes(syncStatus, configured, nowMs);
  return {
    ...report,
    notes: [...healthNotes, ...report.notes],
  };
}

function syncHealthNotes(
  status: ProviderSyncStatusRow[],
  configured: Set<string>,
  nowMs: number,
): string[] {
  const notes: string[] = [];
  for (const row of status) {
    if (!configured.has(row.provider) && row.status === "not_configured") {
      continue;
    }
    if (row.status === "error") {
      notes.push(
        `Provider ${row.provider} sync error: ${row.last_error ?? "unknown"} — reconciliation may understate spend.`,
      );
    } else if (row.last_success_at) {
      const t = new Date(row.last_success_at).getTime();
      if (!Number.isNaN(t) && nowMs - t > SYNC_STALE_MS) {
        notes.push(
          `Provider ${row.provider} last success is stale (>36h) — billing data may lag.`,
        );
      }
    }
  }
  return notes;
}
