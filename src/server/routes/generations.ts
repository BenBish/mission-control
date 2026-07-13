import type { Express, Request, Response } from "express";
import type { Database } from "../../db/database.js";
import {
  listGenerationJobs,
  getGenerationJob,
} from "../../db/queries/generation.js";
import type { GenerationJobRow } from "../../db/queries/generation.js";

function toApiShape(row: GenerationJobRow) {
  return {
    id: row.id,
    sourceId: row.source_id,
    instanceId: row.instance_id,
    externalId: row.external_id,
    status: row.status,
    firstSeenAt: row.first_seen_at,
    observedStartedAt: row.observed_started_at,
    observedCompletedAt: row.observed_completed_at,
    workflowHash: row.workflow_hash,
    nodeCount: row.node_count,
    outputCount: row.output_count,
    details: row.details ? JSON.parse(row.details) : null,
  };
}

/**
 * Generation jobs (ComfyUI today; Lemonade doesn't emit these — it's an
 * inference source, not a generation-job one, per sources.ts's `kind`).
 * Card-grid + detail shape, reusing src/app/skills/** 's UI pattern per
 * the plan — the backend here is intentionally minimal (list + single-
 * job lookup), no mutation endpoints since these are collector-observed
 * facts, not user-controllable jobs.
 */
export function registerGenerationRoutes(app: Express, db: Database): void {
  app.get("/api/generations", async (req: Request, res: Response) => {
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const jobs = await listGenerationJobs(db.raw(), limit);
    res.json({ success: true, jobs: jobs.map(toApiShape) });
  });

  app.get("/api/generations/:id", async (req: Request, res: Response) => {
    const job = await getGenerationJob(db.raw(), req.params.id);
    if (!job) {
      return res
        .status(404)
        .json({ success: false, error: "Generation job not found" });
    }
    res.json({ success: true, job: toApiShape(job) });
  });
}
