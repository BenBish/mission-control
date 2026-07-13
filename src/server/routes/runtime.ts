import type { Express, Request, Response } from "express";
import type { Database } from "../../db/database.js";
import { listSources } from "../../db/queries/sources.js";
import {
  latestRuntimeSnapshots,
  listRecentInferenceRequests,
  listRecentRuntimeEvents,
} from "../../db/queries/telemetry.js";

/**
 * Runtime page data: per-instance health/status (from source_instances —
 * same registry the Dashboard's source chips use), current occupancy per
 * backend (latest runtime_snapshot per instance+kind, one row per llama-
 * server backend port plus one for llama-swap's own health/models
 * snapshot), recent inference_requests, recent runtime_events.
 */
export function registerRuntimeRoutes(app: Express, db: Database): void {
  app.get("/api/runtime", async (req: Request, res: Response) => {
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const [sources, snapshots, requests, events] = await Promise.all([
      listSources(db.raw()),
      latestRuntimeSnapshots(db.raw()),
      listRecentInferenceRequests(db.raw(), limit),
      listRecentRuntimeEvents(db.raw(), limit),
    ]);

    res.json({
      success: true,
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
      inferenceRequests: requests.map((r) => ({
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
      runtimeEvents: events.map((e) => ({
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
    });
  });
}
