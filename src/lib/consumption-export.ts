/**
 * CSV/JSON serialization for Consumption exports (BSH-146).
 *
 * Pure helpers — used by export routes and unit tests. Does not query the
 * database; callers pass already-filtered provider usage / agent-usage driver
 * rows so date range, source scope, and dimension filters stay with the
 * existing query functions.
 */

export type ExportFormat = "csv" | "json";

export interface ProviderUsageExportRow {
  provider: string;
  day: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number | null;
  request_count: number;
  updated_at?: string | null;
}

export interface AgentUsageDriverExportRow {
  key: string;
  sourceId: string;
  canonicalModel: string;
  rawModels: string[];
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
  sessionCount: number;
  materiality: string;
  attribution: string;
}

export interface ProviderUsageExportMeta {
  since?: string | null;
  provider?: string | null;
  exportedAt?: string;
}

export interface AgentUsageDriversExportMeta {
  since?: string | null;
  until?: string | null;
  sourceId?: string | null;
  dimension?: string;
  includeNonMaterial?: boolean;
  exportedAt?: string;
}

export const PROVIDER_USAGE_CSV_HEADERS = [
  "day",
  "provider",
  "model",
  "input_tokens",
  "output_tokens",
  "cost_usd",
  "request_count",
] as const;

export const AGENT_USAGE_DRIVER_CSV_HEADERS = [
  "key",
  "source_id",
  "canonical_model",
  "raw_models",
  "project",
  "session_id",
  "session_title",
  "actor_id",
  "actor_type",
  "input_tokens",
  "output_tokens",
  "cache_read_tokens",
  "cache_write_tokens",
  "cost_usd",
  "has_cost",
  "request_count",
  "session_count",
  "materiality",
  "attribution",
] as const;

/** Missing / empty `format` defaults to csv; unknown values are rejected. */
export function parseExportFormat(raw: unknown): ExportFormat | undefined {
  if (raw === undefined || raw === null || raw === "") return "csv";
  if (typeof raw !== "string") return undefined;
  const value = raw.trim().toLowerCase();
  if (value === "csv" || value === "json") return value;
  return undefined;
}

export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text =
    typeof value === "boolean" ? (value ? "true" : "false") : String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function toCsv(headers: readonly string[], rows: unknown[][]): string {
  const lines = [
    headers.map(csvEscape).join(","),
    ...rows.map((row) => row.map(csvEscape).join(",")),
  ];
  return `${lines.join("\r\n")}\r\n`;
}

export function serializeProviderUsageCsv(
  rows: ProviderUsageExportRow[],
): string {
  return toCsv(
    PROVIDER_USAGE_CSV_HEADERS,
    rows.map((row) => [
      row.day,
      row.provider,
      row.model,
      row.input_tokens,
      row.output_tokens,
      row.cost_usd,
      row.request_count,
    ]),
  );
}

export function serializeAgentUsageDriversCsv(
  rows: AgentUsageDriverExportRow[],
): string {
  return toCsv(
    AGENT_USAGE_DRIVER_CSV_HEADERS,
    rows.map((row) => [
      row.key,
      row.sourceId,
      row.canonicalModel,
      row.rawModels.join("; "),
      row.project,
      row.sessionId,
      row.sessionTitle,
      row.actorId,
      row.actorType,
      row.inputTokens,
      row.outputTokens,
      row.cacheReadTokens,
      row.cacheWriteTokens,
      row.costUsd,
      row.hasCost,
      row.requestCount,
      row.sessionCount,
      row.materiality,
      row.attribution,
    ]),
  );
}

export function buildProviderUsageExportJson(
  rows: ProviderUsageExportRow[],
  meta: ProviderUsageExportMeta = {},
): Record<string, unknown> {
  return {
    success: true,
    dataset: "provider-usage",
    source: "provider-api",
    exportedAt: meta.exportedAt ?? new Date().toISOString(),
    filters: {
      since: meta.since ?? null,
      provider: meta.provider ?? null,
    },
    usage: rows,
  };
}

export function buildAgentUsageDriversExportJson(
  rows: AgentUsageDriverExportRow[],
  meta: AgentUsageDriversExportMeta = {},
): Record<string, unknown> {
  return {
    success: true,
    dataset: "agent-usage-drivers",
    source: "agent-usage",
    exportedAt: meta.exportedAt ?? new Date().toISOString(),
    filters: {
      since: meta.since ?? null,
      until: meta.until ?? null,
      sourceId: meta.sourceId ?? null,
      dimension: meta.dimension ?? "model",
      includeNonMaterial: meta.includeNonMaterial === true,
    },
    drivers: rows,
  };
}

function sanitizeFilenamePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

export function consumptionExportFilename(
  dataset: "provider-usage" | "agent-usage-drivers",
  format: ExportFormat,
  extras: { since?: string; dimension?: string } = {},
): string {
  const parts = [dataset];
  if (extras.dimension) {
    const dim = sanitizeFilenamePart(extras.dimension);
    if (dim) parts.push(dim);
  }
  if (extras.since) {
    const day = extras.since.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) parts.push(`since-${day}`);
  }
  return `${parts.join("-")}.${format}`;
}

function toQueryString(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, value);
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export function providerUsageExportPath(opts: {
  format: ExportFormat;
  since?: string;
  provider?: string;
}): string {
  return `/api/providers/usage/export${toQueryString({
    format: opts.format,
    since: opts.since,
    provider: opts.provider,
  })}`;
}

export function agentUsageDriversExportPath(opts: {
  format: ExportFormat;
  since?: string;
  until?: string;
  sourceId?: string;
  dimension?: string;
  includeNonMaterial?: boolean;
}): string {
  return `/api/consumption/agent-usage/export${toQueryString({
    format: opts.format,
    since: opts.since,
    until: opts.until,
    sourceId: opts.sourceId,
    dimension: opts.dimension,
    includeNonMaterial: opts.includeNonMaterial ? "1" : undefined,
  })}`;
}
