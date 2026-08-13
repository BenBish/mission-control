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

/**
 * Performance target for the default Runtime summary view (BSH-102).
 * Summary should return under this budget on a live-sized dataset
 * (~5k inference_requests in the selected window, ~100 snapshots, ~200 events).
 * Measured via Server-Timing `app` and asserted in runtime tests.
 */
export const RUNTIME_SUMMARY_TARGET_MS = 250;

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

/**
 * Response section for progressive loading (BSH-102):
 * - summary: sources, slim snapshots, metrics, filters, requestsByClient
 * - lists: paginated inferenceRequests + runtimeEvents
 * - all: both (default, backward compatible)
 */
export type RuntimeSection = "summary" | "lists" | "all";

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

export function parseRuntimeSection(raw: unknown): RuntimeSection {
  if (raw === "summary" || raw === "lists" || raw === "all") return raw;
  return "all";
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
 * Slim snapshot payload for the default UI — only port/label are used
 * for slot occupancy identification. Collectors may store large raw
 * system-stats objects; never ship those on the Runtime page.
 */
export function slimSnapshotPayload(
  raw: unknown,
): { port?: number; label?: string } | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  const slim: { port?: number; label?: string } = {};
  if (typeof obj.port === "number" && Number.isFinite(obj.port)) {
    slim.port = obj.port;
  }
  if (typeof obj.label === "string" && obj.label.length > 0) {
    slim.label = obj.label;
  }
  return slim.port != null || slim.label != null ? slim : null;
}

/**
 * Runtime page data: per-instance health/status (from source_instances —
 * same registry the Dashboard's source chips use), current occupancy per
 * backend (latest runtime_snapshot per instance+kind), operational metrics,
 * and filterable paginated inference_requests / runtime_events.
 *
 * Query params:
 *   section     – summary|lists|all (default all) — progressive loading
 *   range       – 1h|6h|24h|7d|all (default 24h) — metrics + list time window
 *   sourceId    – filter requests + events by source_id (e.g. hermes)
 *   reqStatus   – success|cancelled|context_overflow|error
 *   reqClient   – client_label exact match
 *   reqMinDurationMs – minimum duration_ms for "slow" triage
 *   reqPage     – 1-based page (default 1)
 *   reqLimit    – page size (default 20, max 1000)
 *   eventKind   – runtime_events.kind
 *   eventPage   – 1-based page (default 1)
 *   eventLimit  – page size (default 20, max 1000)
 *   limit       – legacy alias applied to both lists when specific limits absent
 */
export function registerRuntimeRoutes(app: Express, db: Database): void {
  app.get("/api/runtime", async (req: Request, res: Response) => {
    const started = performance.now();
    try {
      const range = parseRuntimeRange(req.query.range);
      const section = parseRuntimeSection(req.query.section);
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

      // Duration is ms (not a page limit) — allow up to 24h so p95-based
      // "slow" filters are not clamped to MAX_QUERY_LIMIT (1000).
      const reqMinDurationResult = parseOptionalPositiveInt(
        req.query.reqMinDurationMs,
        "reqMinDurationMs",
        24 * 60 * 60 * 1000,
      );
      if (!reqMinDurationResult.ok) {
        res.status(400).json({
          success: false,
          error: reqMinDurationResult.error,
        });
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
      const reqMinDurationMs = reqMinDurationResult.value;

      const raw = db.raw();
      const wantSummary = section === "summary" || section === "all";
      const wantLists = section === "lists" || section === "all";

      // Fetch snapshots first when building summary so metrics can reuse them
      // (avoids double latestRuntimeSnapshots join on every poll).
      const snapshots = wantSummary
        ? await latestRuntimeSnapshots(raw, sourceId)
        : ([] as Awaited<ReturnType<typeof latestRuntimeSnapshots>>);

      const [
        sources,
        requests,
        events,
        metrics,
        clientLabels,
        requestsByClient,
      ] = await Promise.all([
        wantSummary
          ? listSources(raw)
          : Promise.resolve([] as Awaited<ReturnType<typeof listSources>>),
        wantLists
          ? listInferenceRequests(raw, {
              status: reqStatus,
              clientLabel: reqClient,
              sourceId,
              since,
              minDurationMs: reqMinDurationMs,
              limit: reqLimit,
              offset: reqOffset,
            })
          : Promise.resolve(null),
        wantLists
          ? listRuntimeEvents(raw, {
              kind: eventKind,
              sourceId,
              since,
              limit: eventLimit,
              offset: eventOffset,
            })
          : Promise.resolve(null),
        wantSummary
          ? getRuntimeMetrics(raw, { since, windowHours, snapshots, sourceId })
          : Promise.resolve(null),
        wantSummary
          ? listInferenceClientLabels(raw, sourceId)
          : Promise.resolve([] as string[]),
        wantSummary
          ? listInferenceRequestCountsByClient(raw, { since, sourceId })
          : Promise.resolve(
              [] as Awaited<
                ReturnType<typeof listInferenceRequestCountsByClient>
              >,
            ),
      ]);

      const elapsedMs = Math.round(performance.now() - started);
      res.setHeader(
        "Server-Timing",
        `app;dur=${elapsedMs};desc="runtime ${section}"`,
      );
      res.setHeader("X-Runtime-Section", section);
      res.setHeader("X-Runtime-App-Ms", String(elapsedMs));

      const body: Record<string, unknown> = {
        success: true,
        range,
        section,
      };

      if (wantSummary && metrics) {
        body.sources = sources.filter(
          (s) => s.kind === "inference" && (!sourceId || s.id === sourceId),
        );
        body.snapshots = snapshots.map((s) => {
          let parsedPayload: unknown = null;
          if (s.payload) {
            try {
              parsedPayload = JSON.parse(s.payload);
            } catch {
              parsedPayload = null;
            }
          }
          return {
            sourceId: s.source_id,
            instanceId: s.instance_id,
            timestamp: s.timestamp,
            kind: s.kind,
            slotsTotal: s.slots_total,
            slotsBusy: s.slots_busy,
            modelsLoaded: s.models_loaded ? JSON.parse(s.models_loaded) : null,
            healthy: s.healthy == null ? null : Boolean(s.healthy),
            payload: slimSnapshotPayload(parsedPayload),
          };
        });
        body.metrics = {
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
        };
        body.filters = {
          clientLabels,
          requestStatuses: [...REQUEST_STATUSES],
          eventKinds: [...EVENT_KINDS],
        };
        /** Volume by backend client_label for the selected range (BSH-89). */
        body.requestsByClient = requestsByClient;
      }

      if (wantLists && requests && events) {
        body.inferenceRequests = {
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
        };
        // Event details are omitted from the list payload — default UI only
        // shows kind/severity/summary/timestamps (BSH-102 payload slim).
        body.runtimeEvents = {
          items: events.rows.map((e) => ({
            id: e.id,
            sourceId: e.source_id,
            instanceId: e.instance_id,
            timestamp: e.timestamp,
            endedAt: e.ended_at,
            kind: e.kind,
            severity: e.severity,
            summary: e.summary,
          })),
          total: events.total,
          page: eventPage,
          pageSize: eventLimit,
        };
      }

      res.json(body);
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
