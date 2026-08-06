/**
 * Agent Usage aggregation service (BSH-99).
 *
 * Builds typed camelCase summaries: ranked drivers, coverage, drill-down.
 * Default ranking excludes zero-token and synthetic rows; unknown usage
 * is quantified in coverage rather than mixed silently into drivers.
 */

import type { Database as SqliteDatabase } from "sqlite";
import {
  listAgentUsageFacts,
  type AgentUsageFactRow,
  type AgentUsageRange,
} from "../db/queries/agent-usage.js";
import {
  classifyMateriality,
  normalizeModelIdentity,
  projectLabelFromCwd,
  type ModelMateriality,
} from "../lib/model-identity.js";

export type AgentUsageDimension =
  | "model"
  | "project"
  | "actor"
  | "source"
  | "session";

export type AgentUsageDriver = {
  key: string;
  sourceId: string;
  canonicalModel: string;
  rawModels: string[];
  project: string | null;
  /** Full cwd is never exposed when a project label exists. */
  sessionId: string | null;
  sessionTitle: string | null;
  actorId: string | null;
  actorType: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number | null;
  hasCost: boolean;
  requestCount: number;
  sessionCount: number;
  materiality: ModelMateriality;
  attribution: "known" | "unknown";
};

export type AgentUsageCoverage = {
  totalTokens: number;
  materialTokens: number;
  unattributedTokens: number;
  unattributedPct: number;
  syntheticTokens: number;
  zeroTokenFactCount: number;
  unknownModelTokens: number;
  missingProjectTokens: number;
};

export type AgentUsageTotals = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number | null;
  hasCost: boolean;
  requestCount: number;
  sessionCount: number;
};

export type AgentUsageSummary = {
  range: { since: string | null; until: string | null };
  dimension: AgentUsageDimension;
  includeNonMaterial: boolean;
  totals: AgentUsageTotals;
  coverage: AgentUsageCoverage;
  drivers: AgentUsageDriver[];
};

export type AgentUsageSessionRow = {
  sessionId: string;
  sourceId: string;
  externalId: string | null;
  title: string | null;
  project: string | null;
  startedAt: string | null;
  canonicalModel: string;
  rawModels: string[];
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number | null;
  hasCost: boolean;
  requestCount: number;
};

function totalTokens(row: {
  inputTokens: number;
  outputTokens: number;
}): number {
  return row.inputTokens + row.outputTokens;
}

function factTokens(f: AgentUsageFactRow): number {
  return f.input_tokens + f.output_tokens;
}

function driverKey(
  dimension: AgentUsageDimension,
  parts: {
    sourceId: string;
    canonicalModel: string;
    project: string | null;
    actorId: string;
    sessionId: string;
  },
): string {
  switch (dimension) {
    case "model":
      return `model:${parts.sourceId}:${parts.canonicalModel}`;
    case "project":
      return `project:${parts.sourceId}:${parts.project ?? "unassigned"}`;
    case "actor":
      return `actor:${parts.sourceId}:${parts.actorId}`;
    case "source":
      return `source:${parts.sourceId}`;
    case "session":
      return `session:${parts.sessionId}`;
  }
}

function matchesDriverKey(
  dimension: AgentUsageDimension,
  key: string,
  parts: {
    sourceId: string;
    canonicalModel: string;
    project: string | null;
    actorId: string;
    sessionId: string;
  },
): boolean {
  return driverKey(dimension, parts) === key;
}

export function buildAgentUsageSummary(
  facts: AgentUsageFactRow[],
  opts: {
    dimension?: AgentUsageDimension;
    includeNonMaterial?: boolean;
    since?: string;
    until?: string;
  } = {},
): AgentUsageSummary {
  const dimension = opts.dimension ?? "model";
  const includeNonMaterial = opts.includeNonMaterial === true;

  let totalTokensAll = 0;
  let materialTokens = 0;
  let syntheticTokens = 0;
  let unknownModelTokens = 0;
  let missingProjectTokens = 0;
  let zeroTokenFactCount = 0;
  let unattributedTokens = 0;

  const sessionIds = new Set<string>();
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let costSum = 0;
  let hasCost = false;
  let requestCount = 0;

  type Acc = {
    key: string;
    sourceId: string;
    canonicalModel: string;
    rawModels: Set<string>;
    project: string | null;
    sessionId: string | null;
    sessionTitle: string | null;
    actorId: string | null;
    actorType: string | null;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    costUsd: number | null;
    hasCost: boolean;
    requestCount: number;
    sessions: Set<string>;
    materiality: ModelMateriality;
    attribution: "known" | "unknown";
  };

  const drivers = new Map<string, Acc>();

  for (const f of facts) {
    const identity = normalizeModelIdentity(f.model);
    const project = projectLabelFromCwd(f.session_cwd);
    const materiality = classifyMateriality({
      inputTokens: f.input_tokens,
      outputTokens: f.output_tokens,
      isSynthetic: identity.isSynthetic,
    });
    const tokens = factTokens(f);
    totalTokensAll += tokens;
    inputTokens += f.input_tokens;
    outputTokens += f.output_tokens;
    cacheReadTokens += f.cache_read_tokens;
    cacheWriteTokens += f.cache_write_tokens;
    requestCount += f.request_count;
    sessionIds.add(f.session_id);
    if (f.cost_usd != null) {
      hasCost = true;
      costSum += f.cost_usd;
    }

    if (materiality === "zero") zeroTokenFactCount += 1;
    if (materiality === "synthetic") syntheticTokens += tokens;
    if (materiality === "material") materialTokens += tokens;
    if (identity.isUnknown) unknownModelTokens += tokens;
    if (!project) missingProjectTokens += tokens;

    const attribution: "known" | "unknown" =
      identity.isUnknown || identity.isSynthetic ? "unknown" : "known";
    if (attribution === "unknown") unattributedTokens += tokens;

    // Default ranking: skip non-material facts entirely.
    if (!includeNonMaterial && materiality !== "material") continue;
    // Also skip pure unknown rows from default ranking when dimension is model
    // — they are reported in coverage instead.
    if (
      !includeNonMaterial &&
      dimension === "model" &&
      (identity.isUnknown || identity.isSynthetic)
    ) {
      continue;
    }

    const parts = {
      sourceId: f.source_id,
      canonicalModel: identity.canonical,
      project,
      actorId: f.actor_id,
      sessionId: f.session_id,
    };
    const key = driverKey(dimension, parts);
    const existing = drivers.get(key);
    if (existing) {
      existing.inputTokens += f.input_tokens;
      existing.outputTokens += f.output_tokens;
      existing.cacheReadTokens += f.cache_read_tokens;
      existing.cacheWriteTokens += f.cache_write_tokens;
      existing.requestCount += f.request_count;
      existing.sessions.add(f.session_id);
      existing.rawModels.add(identity.raw);
      if (f.cost_usd != null) {
        existing.hasCost = true;
        existing.costUsd = (existing.costUsd ?? 0) + f.cost_usd;
      }
      // Prefer material over zero if mixed
      if (materiality === "material") existing.materiality = "material";
      if (attribution === "known") existing.attribution = "known";
    } else {
      drivers.set(key, {
        key,
        sourceId: f.source_id,
        canonicalModel: identity.canonical,
        rawModels: new Set([identity.raw]),
        // Project label (never full cwd) always available for display context.
        project,
        sessionId: dimension === "session" ? f.session_id : null,
        sessionTitle: dimension === "session" ? f.session_title : null,
        actorId: dimension === "actor" ? f.actor_id : null,
        actorType: dimension === "actor" ? f.actor_type : null,
        inputTokens: f.input_tokens,
        outputTokens: f.output_tokens,
        cacheReadTokens: f.cache_read_tokens,
        cacheWriteTokens: f.cache_write_tokens,
        costUsd: f.cost_usd,
        hasCost: f.cost_usd != null,
        requestCount: f.request_count,
        sessions: new Set([f.session_id]),
        materiality,
        attribution,
      });
    }
  }

  const driverList: AgentUsageDriver[] = Array.from(drivers.values())
    .map((d) => ({
      key: d.key,
      sourceId: d.sourceId,
      canonicalModel: d.canonicalModel,
      rawModels: Array.from(d.rawModels).sort(),
      project: d.project,
      sessionId: d.sessionId,
      sessionTitle: d.sessionTitle,
      actorId: d.actorId,
      actorType: d.actorType,
      inputTokens: d.inputTokens,
      outputTokens: d.outputTokens,
      cacheReadTokens: d.cacheReadTokens,
      cacheWriteTokens: d.cacheWriteTokens,
      costUsd: d.hasCost ? d.costUsd : null,
      hasCost: d.hasCost,
      requestCount: d.requestCount,
      sessionCount: d.sessions.size,
      materiality: d.materiality,
      attribution: d.attribution,
    }))
    .sort(
      (a, b) =>
        totalTokens(b) - totalTokens(a) ||
        b.requestCount - a.requestCount ||
        a.key.localeCompare(b.key),
    );

  const unattributedPct =
    totalTokensAll > 0
      ? Math.round((unattributedTokens / totalTokensAll) * 1000) / 10
      : 0;

  return {
    range: {
      since: opts.since ?? null,
      until: opts.until ?? null,
    },
    dimension,
    includeNonMaterial,
    totals: {
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      costUsd: hasCost ? costSum : null,
      hasCost,
      requestCount,
      sessionCount: sessionIds.size,
    },
    coverage: {
      totalTokens: totalTokensAll,
      materialTokens,
      unattributedTokens,
      unattributedPct,
      syntheticTokens,
      zeroTokenFactCount,
      unknownModelTokens,
      missingProjectTokens,
    },
    drivers: driverList,
  };
}

export async function getAgentUsageSummary(
  db: SqliteDatabase,
  opts: AgentUsageRange & {
    dimension?: AgentUsageDimension;
    includeNonMaterial?: boolean;
  } = {},
): Promise<AgentUsageSummary> {
  const facts = await listAgentUsageFacts(db, opts);
  return buildAgentUsageSummary(facts, opts);
}

export function buildAgentUsageSessionsForDriver(
  facts: AgentUsageFactRow[],
  opts: {
    dimension: AgentUsageDimension;
    driverKey: string;
  },
): AgentUsageSessionRow[] {
  const bySession = new Map<
    string,
    {
      sessionId: string;
      sourceId: string;
      externalId: string | null;
      title: string | null;
      project: string | null;
      startedAt: string | null;
      rawModels: Set<string>;
      canonicalModels: Set<string>;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheWriteTokens: number;
      costUsd: number | null;
      hasCost: boolean;
      requestCount: number;
    }
  >();

  for (const f of facts) {
    const identity = normalizeModelIdentity(f.model);
    const project = projectLabelFromCwd(f.session_cwd);
    const parts = {
      sourceId: f.source_id,
      canonicalModel: identity.canonical,
      project,
      actorId: f.actor_id,
      sessionId: f.session_id,
    };
    if (!matchesDriverKey(opts.dimension, opts.driverKey, parts)) continue;

    const existing = bySession.get(f.session_id);
    if (existing) {
      existing.inputTokens += f.input_tokens;
      existing.outputTokens += f.output_tokens;
      existing.cacheReadTokens += f.cache_read_tokens;
      existing.cacheWriteTokens += f.cache_write_tokens;
      existing.requestCount += f.request_count;
      existing.rawModels.add(identity.raw);
      existing.canonicalModels.add(identity.canonical);
      if (f.cost_usd != null) {
        existing.hasCost = true;
        existing.costUsd = (existing.costUsd ?? 0) + f.cost_usd;
      }
    } else {
      bySession.set(f.session_id, {
        sessionId: f.session_id,
        sourceId: f.source_id,
        externalId: f.session_external_id,
        title: f.session_title,
        project,
        startedAt: f.session_started_at,
        rawModels: new Set([identity.raw]),
        canonicalModels: new Set([identity.canonical]),
        inputTokens: f.input_tokens,
        outputTokens: f.output_tokens,
        cacheReadTokens: f.cache_read_tokens,
        cacheWriteTokens: f.cache_write_tokens,
        costUsd: f.cost_usd,
        hasCost: f.cost_usd != null,
        requestCount: f.request_count,
      });
    }
  }

  return Array.from(bySession.values())
    .map((s) => ({
      sessionId: s.sessionId,
      sourceId: s.sourceId,
      externalId: s.externalId,
      title: s.title,
      project: s.project,
      startedAt: s.startedAt,
      canonicalModel: Array.from(s.canonicalModels).sort().join(", "),
      rawModels: Array.from(s.rawModels).sort(),
      inputTokens: s.inputTokens,
      outputTokens: s.outputTokens,
      cacheReadTokens: s.cacheReadTokens,
      cacheWriteTokens: s.cacheWriteTokens,
      costUsd: s.hasCost ? s.costUsd : null,
      hasCost: s.hasCost,
      requestCount: s.requestCount,
    }))
    .sort(
      (a, b) =>
        b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens) ||
        (b.startedAt ?? "").localeCompare(a.startedAt ?? ""),
    );
}

export async function getAgentUsageSessionsForDriver(
  db: SqliteDatabase,
  opts: AgentUsageRange & {
    dimension: AgentUsageDimension;
    driverKey: string;
  },
): Promise<AgentUsageSessionRow[]> {
  const facts = await listAgentUsageFacts(db, opts);
  return buildAgentUsageSessionsForDriver(facts, opts);
}
