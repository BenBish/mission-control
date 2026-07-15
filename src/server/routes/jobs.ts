import type { Express, Request, Response } from "express";
import type { Database } from "../../db/database.js";
import {
  listBackgroundJobs,
  getBackgroundJob,
  listJobRuns,
  latestJobRun,
  type JobRunRow,
} from "../../db/queries/jobs.js";

/**
 * Backs the repurposed Cron UI (src/app/cron/**, src/types/cron.ts). Field
 * names are chosen to line up with CronJobState/RunHistory where the
 * concepts still map (status/duration/output/error/timestamp), but this is
 * observed background work, not scheduled cron jobs — there's no
 * schedule/delivery/payload config to report, so those fields are dropped
 * rather than faked.
 */
function toRunHistory(row: JobRunRow) {
  return {
    id: row.id,
    jobId: row.job_id,
    timestamp: new Date(row.started_at).getTime(),
    status: row.status,
    duration: row.duration_ms ?? undefined,
    output: row.output ?? undefined,
    error: row.error ?? undefined,
  };
}

function countConsecutiveErrors(runs: JobRunRow[]): number {
  let count = 0;
  for (const run of runs) {
    if (run.status === "failure" || run.status === "timeout") count++;
    else break;
  }
  return count;
}

export function registerJobRoutes(app: Express, db: Database): void {
  app.get("/api/jobs", async (_req: Request, res: Response) => {
    const jobs = await listBackgroundJobs(db.raw());
    const withState = await Promise.all(
      jobs.map(async (job) => {
        const recentRuns = await listJobRuns(db.raw(), job.id, 10);
        const last = recentRuns[0];
        return {
          id: job.id,
          name: job.name,
          sourceId: job.source_id,
          kind: job.kind,
          enabled: job.enabled === 1,
          state: {
            lastRunAtMs: last ? new Date(last.started_at).getTime() : undefined,
            lastRunStatus: last?.status,
            lastDurationMs: last?.duration_ms ?? undefined,
            lastError: last?.error ?? undefined,
            consecutiveErrors: countConsecutiveErrors(recentRuns),
          },
        };
      }),
    );
    res.json({ success: true, jobs: withState });
  });

  app.get("/api/jobs/:id", async (req: Request, res: Response) => {
    const job = await getBackgroundJob(db.raw(), req.params.id);
    if (!job) {
      return res.status(404).json({ success: false, error: "Job not found" });
    }
    const last = await latestJobRun(db.raw(), job.id);
    res.json({
      success: true,
      job: {
        id: job.id,
        name: job.name,
        sourceId: job.source_id,
        kind: job.kind,
        enabled: job.enabled === 1,
        state: {
          lastRunAtMs: last ? new Date(last.started_at).getTime() : undefined,
          lastRunStatus: last?.status,
          lastDurationMs: last?.duration_ms ?? undefined,
          lastError: last?.error ?? undefined,
        },
      },
    });
  });

  app.get("/api/jobs/:id/runs", async (req: Request, res: Response) => {
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const runs = await listJobRuns(db.raw(), req.params.id, limit);
    res.json({ success: true, runs: runs.map(toRunHistory) });
  });
}
