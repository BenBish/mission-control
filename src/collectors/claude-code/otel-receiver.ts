/**
 * Opt-in OTLP/HTTP (JSON) receiver for Claude Code's native OpenTelemetry
 * export — see BSH-348 (docs/provider-capacity-research.md) for the spike
 * that confirmed `claude_code.api_request` log events and the
 * `claude_code.cost.usage` metric carry real per-request cost data the
 * JSONL session logs never have.
 *
 * This is intentionally NOT a full OTel Collector: it only parses the
 * subset of the OTLP JSON export shape needed to pull cost/token figures
 * back out, and only accepts `Content-Type: application/json` (protobuf is
 * not supported — users must set `OTEL_EXPORTER_OTLP_PROTOCOL=http/json`).
 * No prompt/tool content is ever read from the payload, only numeric
 * cost/token attributes and correlation ids (request id, session id).
 *
 * Binds loopback-only, defaults to port 4318 (the OTel SDK's own default
 * OTLP/HTTP endpoint), so a user who sets
 *   CLAUDE_CODE_ENABLE_TELEMETRY=1 OTEL_METRICS_EXPORTER=otlp OTEL_LOGS_EXPORTER=otlp
 * needs no further endpoint configuration for this to work, though setting
 * OTEL_EXPORTER_OTLP_ENDPOINT explicitly is documented as the reliable path.
 *
 * Entirely additive: if nothing ever POSTs here, the collector's JSONL-only
 * behavior is unchanged.
 */

import http from "http";

export const DEFAULT_OTEL_RECEIVER_PORT = 4318;

/** Drop entries older than this if a request_id never gets matched to a JSONL activity. */
const PENDING_MAX_AGE_MS = 10 * 60 * 1000;
/** Hard cap so a misbehaving/mismatched exporter can't grow this unboundedly. */
const PENDING_MAX_ENTRIES = 2_000;

export interface ApiRequestCost {
  requestId: string;
  costUsd: number;
  sessionExternalId?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

interface PendingEntry extends ApiRequestCost {
  insertedAtMs: number;
}

// ─── Minimal OTLP JSON shapes (subset actually used) ───────────────────────

interface OtlpAnyValue {
  stringValue?: string;
  boolValue?: boolean;
  intValue?: string | number;
  doubleValue?: number;
}

interface OtlpKeyValue {
  key: string;
  value?: OtlpAnyValue;
}

type FlatAttrs = Record<string, string | number | boolean>;

interface OtlpLogRecord {
  attributes?: OtlpKeyValue[];
  eventName?: string;
  body?: OtlpAnyValue;
}

interface OtlpScopeLogs {
  logRecords?: OtlpLogRecord[];
}

interface OtlpResourceLogs {
  resource?: { attributes?: OtlpKeyValue[] };
  scopeLogs?: OtlpScopeLogs[];
}

export interface OtlpExportLogsServiceRequest {
  resourceLogs?: OtlpResourceLogs[];
}

interface OtlpNumberDataPoint {
  attributes?: OtlpKeyValue[];
  asDouble?: number;
  asInt?: string | number;
}

interface OtlpMetric {
  name: string;
  sum?: { dataPoints?: OtlpNumberDataPoint[] };
  gauge?: { dataPoints?: OtlpNumberDataPoint[] };
}

interface OtlpScopeMetrics {
  metrics?: OtlpMetric[];
}

interface OtlpResourceMetrics {
  resource?: { attributes?: OtlpKeyValue[] };
  scopeMetrics?: OtlpScopeMetrics[];
}

export interface OtlpExportMetricsServiceRequest {
  resourceMetrics?: OtlpResourceMetrics[];
}

// ─── Pure parsing helpers (unit-tested directly) ───────────────────────────

function parseAnyValue(
  value: OtlpAnyValue | undefined,
): string | number | boolean | undefined {
  if (!value) return undefined;
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.boolValue !== undefined) return value.boolValue;
  if (value.doubleValue !== undefined) return value.doubleValue;
  if (value.intValue !== undefined) return Number(value.intValue);
  return undefined;
}

export function flattenAttributes(
  attrs: OtlpKeyValue[] | undefined,
): FlatAttrs {
  const out: FlatAttrs = {};
  for (const kv of attrs ?? []) {
    const v = parseAnyValue(kv.value);
    if (v !== undefined) out[kv.key] = v;
  }
  return out;
}

function num(v: string | number | boolean | undefined): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function str(v: string | number | boolean | undefined): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * Pull `claude_code.api_request` events out of an OTLP logs export.
 * Pure — never throws on malformed input, just skips what it can't read.
 */
export function extractApiRequestCosts(
  body: OtlpExportLogsServiceRequest,
): ApiRequestCost[] {
  const results: ApiRequestCost[] = [];
  for (const resourceLogs of body.resourceLogs ?? []) {
    const resourceAttrs = flattenAttributes(resourceLogs.resource?.attributes);
    for (const scopeLogs of resourceLogs.scopeLogs ?? []) {
      for (const record of scopeLogs.logRecords ?? []) {
        const recordAttrs = flattenAttributes(record.attributes);
        const attrs: FlatAttrs = { ...resourceAttrs, ...recordAttrs };
        const eventName = record.eventName ?? str(attrs["event.name"]);
        if (eventName !== "claude_code.api_request") continue;

        const requestId = str(attrs["request_id"]) ?? str(attrs["request.id"]);
        if (!requestId) continue;

        const costUsd =
          num(attrs["cost_usd"]) ??
          (num(attrs["cost_usd_micros"]) !== undefined
            ? num(attrs["cost_usd_micros"])! / 1_000_000
            : undefined);
        if (costUsd === undefined) continue;

        results.push({
          requestId,
          costUsd,
          sessionExternalId: str(attrs["session.id"]),
          model: str(attrs["model"]),
          inputTokens: num(attrs["input_tokens"]),
          outputTokens: num(attrs["output_tokens"]),
          cacheReadTokens: num(attrs["cache_read_tokens"]),
          cacheCreationTokens: num(attrs["cache_creation_tokens"]),
        });
      }
    }
  }
  return results;
}

export interface SessionCostDelta {
  sessionExternalId: string;
  deltaUsd: number;
}

/**
 * Pull `claude_code.cost.usage` cumulative-sum data points out of an OTLP
 * metrics export and turn them into per-session deltas since the last call.
 * `cumulativeBySeriesKey` is caller-owned state (mutated in place) so the
 * delta math survives across multiple export batches.
 */
export function extractSessionCostDeltas(
  body: OtlpExportMetricsServiceRequest,
  cumulativeBySeriesKey: Map<string, number>,
): SessionCostDelta[] {
  const deltas = new Map<string, number>();
  for (const resourceMetrics of body.resourceMetrics ?? []) {
    const resourceAttrs = flattenAttributes(
      resourceMetrics.resource?.attributes,
    );
    for (const scopeMetrics of resourceMetrics.scopeMetrics ?? []) {
      for (const metric of scopeMetrics.metrics ?? []) {
        if (metric.name !== "claude_code.cost.usage") continue;
        for (const dp of metric.sum?.dataPoints ?? []) {
          const attrs = {
            ...resourceAttrs,
            ...flattenAttributes(dp.attributes),
          };
          const sessionExternalId = str(attrs["session.id"]);
          if (!sessionExternalId) continue;
          const value =
            dp.asDouble ??
            (dp.asInt !== undefined ? Number(dp.asInt) : undefined);
          if (value === undefined || !Number.isFinite(value)) continue;

          const seriesKey = `${sessionExternalId}:${str(attrs["model"]) ?? ""}`;
          const prev = cumulativeBySeriesKey.get(seriesKey) ?? 0;
          // Cumulative temporality is the OTel SDK default: each export
          // carries the running total, not just this interval's slice.
          // A value lower than what we've already seen means the exporter
          // restarted its counter (e.g. process restart) — treat the new
          // value as the delta rather than going negative.
          const delta = value >= prev ? value - prev : value;
          cumulativeBySeriesKey.set(seriesKey, value);
          if (delta > 0) {
            deltas.set(
              sessionExternalId,
              (deltas.get(sessionExternalId) ?? 0) + delta,
            );
          }
        }
      }
    }
  }
  return Array.from(deltas, ([sessionExternalId, deltaUsd]) => ({
    sessionExternalId,
    deltaUsd,
  }));
}

// ─── HTTP receiver ──────────────────────────────────────────────────────────

export interface OtelReceiverOptions {
  /** 0 binds an OS-assigned ephemeral port — useful for tests. */
  port?: number;
  onWarn?: (message: string) => void;
}

/**
 * Collector-facing surface, kept as an interface so tests can inject a
 * lightweight fake instead of binding a real socket per test.
 */
export interface OtelReceiverLike {
  start(): Promise<number | null>;
  stop(): Promise<void>;
  getRequestCost(requestId: string): ApiRequestCost | undefined;
  consumeRequestCost(requestId: string): void;
  drainSessionCostDeltas(): SessionCostDelta[];
}

/**
 * Buffers parsed OTel cost data in memory for the ClaudeCodeCollector to
 * drain on its own tick — kept decoupled from the collector's tick loop so
 * the HTTP listener can run continuously regardless of tick timing.
 */
export class OtelReceiver implements OtelReceiverLike {
  private server: http.Server | undefined;
  private boundPort: number | undefined;
  private readonly requestedPort: number;
  private readonly onWarn: (message: string) => void;

  private pendingByRequestId = new Map<string, PendingEntry>();
  private sessionCostDeltas = new Map<string, number>();
  private cumulativeBySeriesKey = new Map<string, number>();

  constructor(opts: OtelReceiverOptions = {}) {
    this.requestedPort = opts.port ?? DEFAULT_OTEL_RECEIVER_PORT;
    this.onWarn =
      opts.onWarn ?? ((m) => console.warn(`[claude-code:otel] ${m}`));
  }

  /** Resolves with the bound port. Never throws — logs and resolves with null on failure. */
  async start(): Promise<number | null> {
    if (this.server) return this.boundPort ?? null;
    return new Promise((resolve) => {
      const server = http.createServer((req, res) => this.handle(req, res));
      server.on("error", (err) => {
        this.onWarn(
          `failed to start OTLP receiver on port ${this.requestedPort}: ${err instanceof Error ? err.message : String(err)} — OTel cost ingestion disabled this run`,
        );
        resolve(null);
      });
      server.listen(this.requestedPort, "127.0.0.1", () => {
        this.server = server;
        const addr = server.address();
        this.boundPort =
          typeof addr === "object" && addr ? addr.port : this.requestedPort;
        resolve(this.boundPort);
      });
    });
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  /**
   * Look up a request's cost without consuming it — a JSONL line for this
   * request may not have been scanned yet, so callers should retry on a
   * later tick rather than losing the entry after one miss.
   */
  getRequestCost(requestId: string): ApiRequestCost | undefined {
    const entry = this.pendingByRequestId.get(requestId);
    if (!entry) return undefined;
    const { insertedAtMs: _insertedAtMs, ...rest } = entry;
    return rest;
  }

  /** Call once a request's cost has been attached to its matching activity. */
  consumeRequestCost(requestId: string): void {
    this.pendingByRequestId.delete(requestId);
  }

  /** Drains and returns per-session cost deltas accumulated since the last drain. */
  drainSessionCostDeltas(): SessionCostDelta[] {
    const out = Array.from(
      this.sessionCostDeltas,
      ([sessionExternalId, deltaUsd]) => ({
        sessionExternalId,
        deltaUsd,
      }),
    );
    this.sessionCostDeltas.clear();
    return out;
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = req.url ?? "";
    const isLogs = url.endsWith("/v1/logs");
    const isMetrics = url.endsWith("/v1/metrics");
    if (req.method !== "POST" || (!isLogs && !isMetrics)) {
      res.writeHead(404).end();
      return;
    }
    const contentType = req.headers["content-type"] ?? "";
    if (!contentType.includes("application/json")) {
      this.onWarn(
        `received non-JSON OTLP export (content-type: "${contentType}") — set OTEL_EXPORTER_OTLP_PROTOCOL=http/json`,
      );
      res.writeHead(415).end();
      return;
    }

    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
        if (isLogs) {
          this.ingestLogs(parsed as OtlpExportLogsServiceRequest);
        } else {
          this.ingestMetrics(parsed as OtlpExportMetricsServiceRequest);
        }
      } catch (err) {
        this.onWarn(
          `failed to parse OTLP export body: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      res.writeHead(200, { "Content-Type": "application/json" }).end("{}");
    });
  }

  private ingestLogs(body: OtlpExportLogsServiceRequest): void {
    const now = Date.now();
    this.prunePending(now);
    for (const entry of extractApiRequestCosts(body)) {
      this.pendingByRequestId.set(entry.requestId, {
        ...entry,
        insertedAtMs: now,
      });
      while (this.pendingByRequestId.size > PENDING_MAX_ENTRIES) {
        const oldestKey = this.pendingByRequestId.keys().next().value;
        if (oldestKey === undefined) break;
        this.pendingByRequestId.delete(oldestKey);
      }
    }
  }

  private ingestMetrics(body: OtlpExportMetricsServiceRequest): void {
    for (const { sessionExternalId, deltaUsd } of extractSessionCostDeltas(
      body,
      this.cumulativeBySeriesKey,
    )) {
      this.sessionCostDeltas.set(
        sessionExternalId,
        (this.sessionCostDeltas.get(sessionExternalId) ?? 0) + deltaUsd,
      );
    }
  }

  private prunePending(now: number): void {
    for (const [key, entry] of this.pendingByRequestId) {
      if (now - entry.insertedAtMs > PENDING_MAX_AGE_MS) {
        this.pendingByRequestId.delete(key);
      }
    }
  }
}
