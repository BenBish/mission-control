/**
 * Cost efficiency metrics and optimization signals (BSH-105).
 *
 * Provider-API billing (actual spend) and agent-session attribution remain
 * distinct. Efficiency unit economics that need outcome dimensions (session,
 * project, cache, failure) come from agent facts when present; pure
 * provider/model unit costs come from provider_usage_daily.
 *
 * Never sums actual provider spend with allocated subscription or estimated
 * local-compute costs.
 */

import type { ProviderUsageRow } from "../db/queries/provider-usage.js";
import type { AgentUsageFactRow } from "../db/queries/agent-usage.js";
import { projectLabelFromCwd } from "../lib/model-identity.js";
import { normalizeModelIdentity } from "../lib/model-identity.js";

/** Assumed cache-read discount vs full input price (typical provider ~90%). */
export const CACHE_READ_DISCOUNT = 0.9;

/** Minimum spend to surface a recommendation. */
export const REC_MIN_IMPACT_USD = 0.5;

export type CostClass = "actual_provider" | "agent_attributed" | "estimated";

export interface EfficiencySlice {
  dimension: "provider" | "model" | "project" | "overall";
  key: string;
  costClass: CostClass;
  costUsd: number | null;
  requestCount: number;
  sessionCount: number;
  successfulSessionCount: number | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  /** Cost / request when requestCount > 0 and cost known. */
  costPerRequest: number | null;
  /** Cost / session when sessionCount > 0 and cost known. */
  costPerSession: number | null;
  /** Cost / successful session when outcome attribution exists. */
  costPerSuccessfulSession: number | null;
  /** USD per 1M output tokens. */
  costPer1MOutputTokens: number | null;
  /** Estimated savings from cache reads (estimated class). */
  cacheSavingsUsd: number | null;
  /** Agent-attributed cost on sessions/activities with failures. */
  failureWasteUsd: number | null;
  /** Share of agent cost with outcome attribution missing. */
  missingOutcomeAttributionPct: number | null;
  notes: string[];
}

export type OptimizationKind =
  | "expensive_outlier"
  | "cheaper_model"
  | "cache_opportunity"
  | "failure_waste"
  | "local_vs_api";

export interface OptimizationRecommendation {
  kind: OptimizationKind;
  title: string;
  message: string;
  /** Estimated monthly impact in USD if acted on (same class as costClass). */
  estimatedImpactUsd: number;
  costClass: CostClass;
  evidence: {
    dimension?: string;
    key?: string;
    provider?: string | null;
    model?: string | null;
    project?: string | null;
    valueUsd?: number;
    baselineUsd?: number;
    ratio?: number;
    cacheReadTokens?: number;
    failureWasteUsd?: number;
    detail?: string;
  };
  hrefHint: string;
}

export interface FeeCategoryBreakdown {
  /** Actual provider API spend (billing). */
  actualProviderSpendUsd: number;
  /** Agent-attributed session cost (may under-cover). */
  agentAttributedCostUsd: number | null;
  /** Estimated cache savings (not a credit on actual spend). */
  estimatedCacheSavingsUsd: number | null;
  /** Agent cost on failed sessions/activities. */
  failureWasteUsd: number | null;
  notes: string[];
}

function safeDiv(n: number, d: number): number | null {
  if (d <= 0 || !Number.isFinite(n) || !Number.isFinite(d)) return null;
  return n / d;
}

function sumNullable(values: Array<number | null | undefined>): number | null {
  let total = 0;
  let any = false;
  for (const v of values) {
    if (v != null && Number.isFinite(v)) {
      total += v;
      any = true;
    }
  }
  return any ? total : null;
}

/**
 * Estimate cache savings: cache_read tokens would have cost ~input rate;
 * actual charged is ~(1 - discount) of that. Savings ≈ discount × full price.
 * When only totals are known, use cost / (input+output) as rough $/token.
 */
export function estimateCacheSavingsUsd(opts: {
  costUsd: number | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  discount?: number;
}): number | null {
  const discount = opts.discount ?? CACHE_READ_DISCOUNT;
  if (
    opts.cacheReadTokens <= 0 ||
    opts.costUsd == null ||
    !Number.isFinite(opts.costUsd) ||
    opts.costUsd <= 0
  ) {
    return null;
  }
  const billable = opts.inputTokens + opts.outputTokens;
  // Prefer input-weighted rate when we have inputs; else total tokens.
  const denom = opts.inputTokens > 0 ? opts.inputTokens : billable;
  if (denom <= 0) return null;
  const ratePerToken = opts.costUsd / denom;
  const fullPriceIfUncached = opts.cacheReadTokens * ratePerToken;
  return fullPriceIfUncached * discount;
}

export function computeProviderEfficiency(
  usage: ProviderUsageRow[],
): EfficiencySlice[] {
  type Agg = {
    cost: number;
    hasCost: boolean;
    requests: number;
    input: number;
    output: number;
  };
  const overall: Agg = {
    cost: 0,
    hasCost: false,
    requests: 0,
    input: 0,
    output: 0,
  };
  const byProvider = new Map<string, Agg>();
  const byModel = new Map<string, Agg>();

  for (const r of usage) {
    const cost = r.cost_usd;
    const add = (agg: Agg) => {
      if (cost != null) {
        agg.cost += cost;
        agg.hasCost = true;
      }
      agg.requests += r.request_count ?? 0;
      agg.input += r.input_tokens ?? 0;
      agg.output += r.output_tokens ?? 0;
    };
    add(overall);
    const p = byProvider.get(r.provider) ?? {
      cost: 0,
      hasCost: false,
      requests: 0,
      input: 0,
      output: 0,
    };
    add(p);
    byProvider.set(r.provider, p);
    const mk = `${r.provider}/${r.model}`;
    const m = byModel.get(mk) ?? {
      cost: 0,
      hasCost: false,
      requests: 0,
      input: 0,
      output: 0,
    };
    add(m);
    byModel.set(mk, m);
  }

  const toSlice = (
    dimension: EfficiencySlice["dimension"],
    key: string,
    agg: Agg,
  ): EfficiencySlice => {
    const costUsd = agg.hasCost ? agg.cost : null;
    return {
      dimension,
      key,
      costClass: "actual_provider",
      costUsd,
      requestCount: agg.requests,
      sessionCount: 0,
      successfulSessionCount: null,
      inputTokens: agg.input,
      outputTokens: agg.output,
      cacheReadTokens: 0,
      costPerRequest: costUsd != null ? safeDiv(costUsd, agg.requests) : null,
      costPerSession: null,
      costPerSuccessfulSession: null,
      costPer1MOutputTokens:
        costUsd != null && agg.output > 0
          ? (costUsd / agg.output) * 1_000_000
          : null,
      cacheSavingsUsd: null,
      failureWasteUsd: null,
      missingOutcomeAttributionPct: null,
      notes: [
        "Unit costs from provider_usage_daily (actual API billing).",
        "Session/outcome metrics require agent attribution (separate dataset).",
      ],
    };
  };

  const slices: EfficiencySlice[] = [toSlice("overall", "*", overall)];
  for (const [k, agg] of [...byProvider.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    slices.push(toSlice("provider", k, agg));
  }
  for (const [k, agg] of [...byModel.entries()]
    .sort((a, b) => b[1].cost - a[1].cost)
    .slice(0, 40)) {
    slices.push(toSlice("model", k, agg));
  }
  return slices;
}

export function computeAgentEfficiency(
  facts: AgentUsageFactRow[],
): EfficiencySlice[] {
  type Sess = {
    cost: number;
    hasCost: boolean;
    requests: number;
    input: number;
    output: number;
    cacheRead: number;
    failureCount: number;
    project: string | null;
    models: Set<string>;
  };

  // We don't have failure_count on facts; infer weak "outcome" from activity
  // cost only. Missing outcome attribution is quantified when we cannot tell
  // success vs failure (always, for pure cost facts) — report as null success.
  const bySession = new Map<string, Sess>();
  const byProject = new Map<string, Sess>();
  const byModel = new Map<string, Sess>();
  const overall: Sess = {
    cost: 0,
    hasCost: false,
    requests: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    failureCount: 0,
    project: null,
    models: new Set(),
  };

  let factsWithCost = 0;
  let factsTotal = 0;

  for (const f of facts) {
    factsTotal += 1;
    const project = projectLabelFromCwd(f.session_cwd);
    const modelId = normalizeModelIdentity(f.model).canonical;
    const cost = f.cost_usd;
    if (cost != null) factsWithCost += 1;

    const apply = (s: Sess) => {
      if (cost != null) {
        s.cost += cost;
        s.hasCost = true;
      }
      s.requests += f.request_count ?? 0;
      s.input += f.input_tokens ?? 0;
      s.output += f.output_tokens ?? 0;
      s.cacheRead += f.cache_read_tokens ?? 0;
      if (project) s.project = project;
      s.models.add(modelId);
    };

    apply(overall);

    const sid = f.session_id;
    const sess = bySession.get(sid) ?? {
      cost: 0,
      hasCost: false,
      requests: 0,
      input: 0,
      output: 0,
      cacheRead: 0,
      failureCount: 0,
      project,
      models: new Set<string>(),
    };
    apply(sess);
    bySession.set(sid, sess);

    const pk = project ?? "unassigned";
    const proj = byProject.get(pk) ?? {
      cost: 0,
      hasCost: false,
      requests: 0,
      input: 0,
      output: 0,
      cacheRead: 0,
      failureCount: 0,
      project: project,
      models: new Set<string>(),
    };
    apply(proj);
    byProject.set(pk, proj);

    const mk = modelId;
    const mod = byModel.get(mk) ?? {
      cost: 0,
      hasCost: false,
      requests: 0,
      input: 0,
      output: 0,
      cacheRead: 0,
      failureCount: 0,
      project: null,
      models: new Set<string>(),
    };
    apply(mod);
    byModel.set(mk, mod);
  }

  // Optional failure waste: sessions whose failure_count we don't have on
  // facts. Use activity-level isn't available here — caller may pass
  // failureWasteBySession. Without it, failureWasteUsd stays null and
  // missingOutcomeAttributionPct is high when cost exists but outcomes don't.
  const missingOutcomePct =
    factsTotal === 0
      ? null
      : factsWithCost === 0
        ? 100
        : // We never have success/fail on facts alone
          100;

  const toSlice = (
    dimension: EfficiencySlice["dimension"],
    key: string,
    agg: Sess,
    sessionCount: number,
  ): EfficiencySlice => {
    const costUsd = agg.hasCost ? agg.cost : null;
    const cacheSavings = estimateCacheSavingsUsd({
      costUsd,
      inputTokens: agg.input,
      outputTokens: agg.output,
      cacheReadTokens: agg.cacheRead,
    });
    return {
      dimension,
      key,
      costClass: "agent_attributed",
      costUsd,
      requestCount: agg.requests,
      sessionCount,
      successfulSessionCount: null,
      inputTokens: agg.input,
      outputTokens: agg.output,
      cacheReadTokens: agg.cacheRead,
      costPerRequest: costUsd != null ? safeDiv(costUsd, agg.requests) : null,
      costPerSession: costUsd != null ? safeDiv(costUsd, sessionCount) : null,
      costPerSuccessfulSession: null,
      costPer1MOutputTokens:
        costUsd != null && agg.output > 0
          ? (costUsd / agg.output) * 1_000_000
          : null,
      cacheSavingsUsd: cacheSavings,
      failureWasteUsd: null,
      missingOutcomeAttributionPct: missingOutcomePct,
      notes: [
        "Agent-attributed costs from session logs — not actual provider billing.",
        "Successful-session unit cost needs explicit outcome attribution; currently unavailable on raw facts.",
        cacheSavings != null
          ? `Cache savings estimated at ${CACHE_READ_DISCOUNT * 100}% discount on equivalent input tokens (estimated class).`
          : "No cache-read volume to estimate savings.",
      ],
    };
  };

  const slices: EfficiencySlice[] = [
    toSlice("overall", "*", overall, bySession.size),
  ];
  for (const [k, agg] of [...byProject.entries()]
    .sort((a, b) => b[1].cost - a[1].cost)
    .slice(0, 25)) {
    // session count for project: count sessions with that project
    let sc = 0;
    for (const s of bySession.values()) {
      if ((s.project ?? "unassigned") === k) sc += 1;
    }
    slices.push(toSlice("project", k, agg, sc));
  }
  for (const [k, agg] of [...byModel.entries()]
    .sort((a, b) => b[1].cost - a[1].cost)
    .slice(0, 25)) {
    let sc = 0;
    for (const s of bySession.values()) {
      if (s.models.has(k)) sc += 1;
    }
    slices.push(toSlice("model", k, agg, sc));
  }
  return slices;
}

/**
 * Apply session failure waste from sessions table joins.
 * Mutates overall + project slices when failure costs are provided.
 */
export function applyFailureWaste(
  slices: EfficiencySlice[],
  failureWasteUsd: number | null,
  successfulSessionCount: number | null,
  totalSessionsWithCost: number | null,
): EfficiencySlice[] {
  return slices.map((s) => {
    if (s.dimension !== "overall") return s;
    const costUsd = s.costUsd;
    const costPerSuccessfulSession =
      costUsd != null &&
      successfulSessionCount != null &&
      successfulSessionCount > 0
        ? costUsd / successfulSessionCount
        : null;
    const missing =
      totalSessionsWithCost != null && totalSessionsWithCost > 0
        ? successfulSessionCount == null
          ? 100
          : Math.max(
              0,
              ((totalSessionsWithCost - successfulSessionCount) /
                totalSessionsWithCost) *
                100,
            )
        : s.missingOutcomeAttributionPct;
    return {
      ...s,
      failureWasteUsd,
      successfulSessionCount,
      costPerSuccessfulSession,
      missingOutcomeAttributionPct: missing,
      notes: [
        ...s.notes.filter((n) => !n.includes("Successful-session")),
        failureWasteUsd != null
          ? `Failure waste $${failureWasteUsd.toFixed(4)} from sessions with failure_count > 0 (agent-attributed).`
          : "Failure waste unavailable (no failed sessions with cost in range).",
        costPerSuccessfulSession != null
          ? `Cost/successful session uses sessions with failure_count = 0.`
          : "Cost/successful session unavailable without outcome attribution.",
      ],
    };
  });
}

export function buildFeeCategories(opts: {
  actualProviderSpendUsd: number;
  agentAttributedCostUsd: number | null;
  estimatedCacheSavingsUsd: number | null;
  failureWasteUsd: number | null;
}): FeeCategoryBreakdown {
  return {
    actualProviderSpendUsd: opts.actualProviderSpendUsd,
    agentAttributedCostUsd: opts.agentAttributedCostUsd,
    estimatedCacheSavingsUsd: opts.estimatedCacheSavingsUsd,
    failureWasteUsd: opts.failureWasteUsd,
    notes: [
      "actualProviderSpendUsd = provider API billing only.",
      "agentAttributedCostUsd = session-log costs (coverage may be incomplete).",
      "estimatedCacheSavingsUsd is estimated, never subtracted from actual spend.",
      "failureWasteUsd is agent-attributed cost on failed sessions.",
      "Do not sum these classes into a single total.",
    ],
  };
}

export function generateOptimizationRecommendations(opts: {
  providerEfficiency: EfficiencySlice[];
  agentEfficiency: EfficiencySlice[];
  anomalies: Array<{
    kind: string;
    day: string;
    provider: string | null;
    model: string | null;
    valueUsd: number;
    baselineUsd: number;
    ratio: number;
  }>;
  /** Optional local vs API: models with $0 estimated local cost. */
  localModelKeys?: string[];
}): OptimizationRecommendation[] {
  const recs: OptimizationRecommendation[] = [];

  // Expensive outliers from anomalies
  for (const a of opts.anomalies.slice(0, 5)) {
    if (a.ratio < 2 || a.valueUsd < REC_MIN_IMPACT_USD) continue;
    const impact = Math.max(0, a.valueUsd - a.baselineUsd);
    recs.push({
      kind: "expensive_outlier",
      title: a.provider
        ? `Spike: ${a.provider}/${a.model ?? "?"}`
        : `Daily spend spike on ${a.day}`,
      message: a.provider
        ? `${a.provider}/${a.model} spent $${a.valueUsd.toFixed(2)} on ${a.day} (${a.ratio.toFixed(1)}× baseline). Investigate high-cost runs.`
        : `Daily spend $${a.valueUsd.toFixed(2)} on ${a.day} is ${a.ratio.toFixed(1)}× the 7-day baseline.`,
      estimatedImpactUsd: impact,
      costClass: "actual_provider",
      evidence: {
        dimension: a.kind,
        key: a.day,
        provider: a.provider,
        model: a.model,
        valueUsd: a.valueUsd,
        baselineUsd: a.baselineUsd,
        ratio: a.ratio,
        detail: `Anomaly day ${a.day}`,
      },
      hrefHint: "#direct-api-drivers",
    });
  }

  // Cheaper model: high cost/1M output vs peer median within same provider family
  const modelSlices = opts.providerEfficiency.filter(
    (s) => s.dimension === "model" && s.costPer1MOutputTokens != null,
  );
  if (modelSlices.length >= 2) {
    const rates = modelSlices
      .map((s) => s.costPer1MOutputTokens!)
      .sort((a, b) => a - b);
    const median = rates[Math.floor(rates.length / 2)] ?? 0;
    for (const s of modelSlices) {
      const rate = s.costPer1MOutputTokens!;
      if (median <= 0 || rate < median * 2) continue;
      if (s.costUsd == null || s.costUsd < REC_MIN_IMPACT_USD) continue;
      const excessShare = 1 - median / rate;
      const impact = s.costUsd * excessShare * 0.5; // conservative 50% switchable
      if (impact < REC_MIN_IMPACT_USD) continue;
      recs.push({
        kind: "cheaper_model",
        title: `Cheaper model opportunity: ${s.key}`,
        message: `${s.key} costs $${rate.toFixed(2)}/1M output tokens vs peer median $${median.toFixed(2)}. Routing eligible work to a cheaper peer could save ~$${impact.toFixed(2)} (estimated).`,
        estimatedImpactUsd: impact,
        costClass: "actual_provider",
        evidence: {
          dimension: "model",
          key: s.key,
          valueUsd: s.costUsd,
          baselineUsd: median,
          ratio: rate / median,
          detail: `costPer1MOutput=$${rate.toFixed(2)}, peerMedian=$${median.toFixed(2)}`,
        },
        hrefHint: "#direct-api-efficiency",
      });
    }
  }

  // Cache opportunity from agent efficiency
  const agentOverall = opts.agentEfficiency.find(
    (s) => s.dimension === "overall",
  );
  if (
    agentOverall &&
    agentOverall.cacheReadTokens === 0 &&
    agentOverall.inputTokens > 10_000 &&
    agentOverall.costUsd != null &&
    agentOverall.costUsd >= REC_MIN_IMPACT_USD
  ) {
    const potential = agentOverall.costUsd * 0.15;
    recs.push({
      kind: "cache_opportunity",
      title: "Enable prompt caching",
      message: `Agent usage shows ${agentOverall.inputTokens.toLocaleString()} input tokens with zero cache reads. Enabling provider prompt caching could save ~$${potential.toFixed(2)} (estimated 15% of attributed cost).`,
      estimatedImpactUsd: potential,
      costClass: "estimated",
      evidence: {
        dimension: "overall",
        key: "*",
        cacheReadTokens: 0,
        valueUsd: agentOverall.costUsd,
        detail: "No cache_read_tokens in agent facts for range",
      },
      hrefHint: "#agent-usage",
    });
  } else if (
    agentOverall?.cacheSavingsUsd != null &&
    agentOverall.cacheSavingsUsd >= REC_MIN_IMPACT_USD
  ) {
    recs.push({
      kind: "cache_opportunity",
      title: "Cache already saving cost",
      message: `Estimated $${agentOverall.cacheSavingsUsd.toFixed(2)} saved via cache reads this period. Expand caching on high-input workflows to grow savings.`,
      estimatedImpactUsd: agentOverall.cacheSavingsUsd * 0.25,
      costClass: "estimated",
      evidence: {
        dimension: "overall",
        key: "*",
        cacheReadTokens: agentOverall.cacheReadTokens,
        valueUsd: agentOverall.cacheSavingsUsd,
      },
      hrefHint: "#agent-usage",
    });
  }

  // Failure waste
  if (
    agentOverall?.failureWasteUsd != null &&
    agentOverall.failureWasteUsd >= REC_MIN_IMPACT_USD
  ) {
    recs.push({
      kind: "failure_waste",
      title: "Reduce failed-session spend",
      message: `$${agentOverall.failureWasteUsd.toFixed(2)} of agent-attributed cost sits on sessions with failures. Fixing top failure modes recovers that spend.`,
      estimatedImpactUsd: agentOverall.failureWasteUsd,
      costClass: "agent_attributed",
      evidence: {
        dimension: "overall",
        key: "*",
        failureWasteUsd: agentOverall.failureWasteUsd,
      },
      hrefHint: "/failures",
    });
  }

  // Local vs API break-even: if expensive API models have local $0 alternatives
  const localKeys = new Set(opts.localModelKeys ?? []);
  if (localKeys.size > 0) {
    for (const s of modelSlices.slice(0, 10)) {
      if (s.costUsd == null || s.costUsd < REC_MIN_IMPACT_USD * 2) continue;
      // Heuristic: any local model available suggests optional offload
      const impact = s.costUsd * 0.3;
      recs.push({
        kind: "local_vs_api",
        title: `Local offload candidate: ${s.key}`,
        message: `${s.key} has $${s.costUsd.toFixed(2)} actual API spend. Local models are available at $0 estimated compute — offload non-critical work after validating quality (break-even is immediate on volume).`,
        estimatedImpactUsd: impact,
        costClass: "estimated",
        evidence: {
          dimension: "model",
          key: s.key,
          valueUsd: s.costUsd,
          detail: `Local alternatives: ${[...localKeys].slice(0, 3).join(", ")}`,
        },
        hrefHint: "#direct-api-efficiency",
      });
      break; // one local-vs-api rec is enough
    }
  }

  recs.sort((a, b) => b.estimatedImpactUsd - a.estimatedImpactUsd);
  return recs.slice(0, 12);
}

export function sumProviderCost(usage: ProviderUsageRow[]): number {
  let t = 0;
  for (const r of usage) {
    if (r.cost_usd != null) t += r.cost_usd;
  }
  return t;
}

export { sumNullable };
