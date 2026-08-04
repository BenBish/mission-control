import type { Express, Request, Response } from "express";
import type { Database } from "../../db/database.js";
import { listSources } from "../../db/queries/sources.js";
import {
  latestRuntimeSnapshots,
  listInferenceClientLabels,
  listInferenceRequestCountsByClient,
  listInferenceRequests,
  listRuntimeEvents,
  getRuntimeMetrics,
} from "../../db/queries/telemetry.js";
import { optionalQueryString, parseOptionalPositiveInt } from "../query.js";

/** Default page size for request/event lists — keeps the Runtime page bounded. */
export const RUNTIME_DEFAULT_PAGE_SIZE = 20;

const REQUEST_STATUSES = new Set([
  "success",
  "cancelled",
  "context_overflow",
  "error",
]);

const EVENT_KINDS = new Set([
  "slots_saturated",
  "model_load",
  "model_unload",
  "service_down",
  "service_up",
  "context_overflow",
  "request_cancelled",
]);

/** Supported time-range presets for metrics + list filters. */
export type RuntimeRange = "1h" | "6h" | "24h" | "7d" | "all";

const RANGE_MS: Record<Exclude<RuntimeRange, "all">, number> = {
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

export function parseRuntimeRange(raw: unknown): RuntimeRange {
  if (
    raw === "1h" ||
    raw === "6h" ||
    raw === "24h" ||
    raw === "7d" ||
    raw === "all"
  ) {
    return raw;
  }
  return "24h";
}

export function rangeToSince(
  range: RuntimeRange,
  now = Date.now(),
): { since?: string; windowHours: number | null } {
  if (range === "all") return { windowHours: null };
  const ms = RANGE_MS[range];
  return {
    since: new Date(now - ms).toISOString(),
    windowHours: ms / (60 * 60 * 1000),
  };
}

/**
 * Runtime page data: per-instance health/status (from source_instances —
 * same registry the Dashboard's source chips use), current occupancy per
 * backend (latest runtime_snapshot per instance+kind), operational metrics,
 * and filterable paginated inference_requests / runtime_events.
 *
 * Query params:
 *   range       – 1h|6h|24h|7d|all (default 24h) — metrics + list time window
 *   sourceId    – filter requests + events by source_id (e.g. hermes)
 *   reqStatus   – success|cancelled|context_overflow|error
 *   reqClient   – client_label exact match
 *   reqPage     – 1-based page (default 1)
 *   reqLimit    – page size (default 20, max 1000)
 *   eventKind   – runtime_events.kind
 *   eventPage   – 1-based page (default 1)
 *   eventLimit  – page size (default 20, max 1000)
 *   limit       – legacy alias applied to both lists when specific limits absent
 */
export function registerRuntimeRoutes(app: Express, db: Database): void {
  app.get("/api/runtime", async (req: Request, res: Response) => {
    try {
      const range = parseRuntimeRange(req.query.range);
      const { since, windowHours } = rangeToSince(range);

      const legacyLimit = parseOptionalPositiveInt(req.query.limit, "limit");
      if (!legacyLimit.ok) {
        res.status(400).json({ success: false, error: legacyLimit.error });
        return;
      }

      const reqLimitResult = parseOptionalPositiveInt(
        req.query.reqLimit,
        "reqLimit",
      );
      if (!reqLimitResult.ok) {
        res.status(400).json({ success: false, error: reqLimitResult.error });
        return;
      }
      const eventLimitResult = parseOptionalPositiveInt(
        req.query.eventLimit,
        "eventLimit",
      );
      if (!eventLimitResult.ok) {
        res.status(400).json({ success: false, error: eventLimitResult.error });
        return;
      }
      const reqPageResult = parseOptionalPositiveInt(
        req.query.reqPage,
        "reqPage",
      );
      if (!reqPageResult.ok) {
        res.status(400).json({ success: false, error: reqPageResult.error });
        return;
      }
      const eventPageResult = parseOptionalPositiveInt(
        req.query.eventPage,
        "eventPage",
      );
      if (!eventPageResult.ok) {
        res.status(400).json({ success: false, error: eventPageResult.error });
        return;
      }

      const reqStatus = optionalQueryString(req.query.reqStatus);
      if (reqStatus && !REQUEST_STATUSES.has(reqStatus)) {
        res.status(400).json({
          success: false,
          error: `reqStatus must be one of: ${[...REQUEST_STATUSES].join(", ")}`,
        });
        return;
      }

      const eventKind = optionalQueryString(req.query.eventKind);
      if (eventKind && !EVENT_KINDS.has(eventKind)) {
        res.status(400).json({
          success: false,
          error: `eventKind must be one of: ${[...EVENT_KINDS].join(", ")}`,
        });
        return;
      }

      if (Array.isArray(req.query.reqClient)) {
        res.status(400).json({
          success: false,
          error: "reqClient must be a single string",
        });
        return;
      }
      const reqClient = optionalQueryString(req.query.reqClient);

      if (Array.isArray(req.query.sourceId)) {
        res.status(400).json({
          success: false,
          error: "sourceId must be a single string",
        });
        return;
      }
      const sourceId = optionalQueryString(req.query.sourceId);

      const reqLimit =
        reqLimitResult.value ?? legacyLimit.value ?? RUNTIME_DEFAULT_PAGE_SIZE;
      const eventLimit =
        eventLimitResult.value ??
        legacyLimit.value ??
        RUNTIME_DEFAULT_PAGE_SIZE;
      const reqPage = reqPageResult.value ?? 1;
      const eventPage = eventPageResult.value ?? 1;
      const reqOffset = (reqPage - 1) * reqLimit;
      const eventOffset = (eventPage - 1) * eventLimit;

      const raw = db.raw();
      const [
        sources,
        snapshots,
        requests,
        events,
        metrics,
        clientLabels,
        requestsByClient,
      ] = await Promise.all([
        listSources(raw),
        latestRuntimeSnapshots(raw),
        listInferenceRequests(raw, {
          status: reqStatus,
          clientLabel: reqClient,
          sourceId,
          since,
          limit: reqLimit,
          offset: reqOffset,
        }),
        listRuntimeEvents(raw, {
          kind: eventKind,
          sourceId,
          since,
          limit: eventLimit,
          offset: eventOffset,
        }),
        getRuntimeMetrics(raw, { since, windowHours }),
        listInferenceClientLabels(raw),
        listInferenceRequestCountsByClient(raw, { since, sourceId }),
      ]);

      res.json({
        success: true,
        range,
        sources: sources.filter((s) => s.kind === "inference"),
        snapshots: snapshots.map((s) => ({
          sourceId: s.source_id,
          instanceId: s.instance_id,
          timestamp: s.timestamp,
          kind: s.kind,
          slotsTotal: s.slots_total,
          slotsBusy: s.slots_busy,
          modelsLoaded: s.models_loaded ? JSON.parse(s.models_loaded) : null,
          healthy: s.healthy == null ? null : Boolean(s.healthy),
          payload: s.payload ? JSON.parse(s.payload) : null,
        })),
        metrics: {
          activeSlots: metrics.activeSlots,
          totalSlots: metrics.totalSlots,
          saturationRate: metrics.saturationRate,
          requestThroughputPerHour: metrics.requestThroughputPerHour,
          cancellationRate: metrics.cancellationRate,
          p50LatencyMs: metrics.p50LatencyMs,
          p95LatencyMs: metrics.p95LatencyMs,
          requestCount: metrics.requestCount,
          since: metrics.since,
          windowHours: metrics.windowHours,
        },
        filters: {
          clientLabels,
          requestStatuses: [...REQUEST_STATUSES],
          eventKinds: [...EVENT_KINDS],
        },
        /** Volume by backend client_label for the selected range (BSH-89). */
        requestsByClient,
        inferenceRequests: {
          items: requests.rows.map((r) => ({
            id: r.id,
            sourceId: r.source_id,
            instanceId: r.instance_id,
            timestamp: r.timestamp,
            model: r.model,
            clientLabel: r.client_label,
            workload: r.workload,
            promptTokens: r.prompt_tokens,
            completionTokens: r.completion_tokens,
            ttftMs: r.ttft_ms,
            durationMs: r.duration_ms,
            tokensPerSec: r.tokens_per_sec,
            slotId: r.slot_id,
            status: r.status,
            error: r.error,
          })),
          total: requests.total,
          page: reqPage,
          pageSize: reqLimit,
        },
        runtimeEvents: {
          items: events.rows.map((e) => ({
            id: e.id,
            sourceId: e.source_id,
            instanceId: e.instance_id,
            timestamp: e.timestamp,
            endedAt: e.ended_at,
            kind: e.kind,
            severity: e.severity,
            summary: e.summary,
            details: e.details ? JSON.parse(e.details) : null,
          })),
          total: events.total,
          page: eventPage,
          pageSize: eventLimit,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[runtime] GET /api/runtime failed:", message);
      res.status(500).json({
        success: false,
        error: "Failed to load runtime data",
      });
    }
  });
}
