/**
 * CronService Tests
 * Tests cron job listing, enrichment, schedule formatting, and cache behavior.
 *
 * getJobs() now queries the gateway via `openclaw cron list --all --json`.
 * CLI calls are mocked via CronService._setExecFileAsync() to avoid real CLI
 * dependency and prevent slow/flaky tests.
 */

import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { CronService } from "../../services/cron-service.js";
import type { CronJob } from "../../types/cron.js";

const MOCK_JOBS_RESPONSE = JSON.stringify({
  jobs: [
    {
      id: "job-1",
      name: "Test Cron Job",
      schedule: { kind: "cron", expr: "0 * * * *" },
      payload: { kind: "systemEvent", text: "test" },
      sessionTarget: "main",
      enabled: true,
    },
    {
      id: "job-2",
      name: "Interval Job",
      schedule: { kind: "every", everyMs: 300000 },
      payload: { kind: "systemEvent", text: "ping" },
      sessionTarget: "main",
      enabled: true,
    },
  ],
  total: 2,
});

const MOCK_RUNS_RESPONSE = JSON.stringify({
  entries: [
    {
      ts: Date.now() - 60000,
      jobId: "job-1",
      action: "run",
      status: "ok",
      summary: "Completed successfully",
      runAtMs: Date.now() - 120000,
      durationMs: 1500,
      sessionId: "sess-1",
    },
    {
      ts: Date.now() - 120000,
      jobId: "job-1",
      action: "run",
      status: "timeout",
      error: "Timed out after 30s",
      runAtMs: Date.now() - 180000,
      durationMs: 30000,
      sessionId: "sess-2",
    },
  ],
});

/** Controls mock behavior per-test */
let mockShouldFail = false;
let mockJobsResponse = MOCK_JOBS_RESPONSE;
let mockRunsResponse = MOCK_RUNS_RESPONSE;
let lastExecArgs: string[] = [];

/**
 * Fake execFileAsync that returns mock responses based on the CLI args.
 */
const fakeExecFileAsync = async (
  cmd: string,
  args: string[],
  opts?: any,
): Promise<{ stdout: string; stderr: string }> => {
  lastExecArgs = args;
  if (mockShouldFail) {
    const err = new Error("CLI not found") as any;
    err.stderr = "command not found: openclaw";
    throw err;
  }

  if (args.includes("list")) {
    return { stdout: mockJobsResponse, stderr: "" };
  } else if (args.includes("runs")) {
    return { stdout: mockRunsResponse, stderr: "" };
  }
  return { stdout: "{}", stderr: "" };
};

describe("CronService", () => {
  beforeEach(() => {
    CronService.clearCache();
    mockShouldFail = false;
    mockJobsResponse = MOCK_JOBS_RESPONSE;
    mockRunsResponse = MOCK_RUNS_RESPONSE;
    lastExecArgs = [];
    // Inject the mock
    CronService._setExecFileAsync(fakeExecFileAsync as any);
  });

  afterAll(() => {
    // Restore real implementation
    CronService._setExecFileAsync(null);
  });

  // ==========================================================================
  // getJobs - queries gateway via CLI (mocked)
  // ==========================================================================

  describe("getJobs", () => {
    test("should return an array of enriched jobs", async () => {
      const jobs = await CronService.getJobs();
      expect(Array.isArray(jobs)).toBe(true);
      expect(jobs.length).toBe(2);
      for (const job of jobs) {
        expect(job.id).toBeTruthy();
        expect(job.scheduleHuman).toBeTruthy();
      }
    });

    test("should cache results on subsequent calls", async () => {
      const first = await CronService.getJobs();
      const second = await CronService.getJobs();
      // Same reference (from cache)
      expect(first).toEqual(second);
    });

    test("should re-read after cache clear", async () => {
      const first = await CronService.getJobs();
      CronService.clearCache();
      const second = await CronService.getJobs();
      // Should still be equal content (same mock data)
      expect(first.length).toBe(second.length);
    });

    test("should return empty array when CLI fails", async () => {
      mockShouldFail = true;
      const jobs = await CronService.getJobs();
      expect(jobs).toEqual([]);
    });
  });

  // ==========================================================================
  // getJob
  // ==========================================================================

  describe("getJob", () => {
    test("should return null for non-existent job", async () => {
      const job = await CronService.getJob("definitely-does-not-exist-12345");
      expect(job).toBeNull();
    });

    test("should find job by ID if it exists", async () => {
      const found = await CronService.getJob("job-1");
      expect(found).toBeTruthy();
      expect(found!.id).toBe("job-1");
    });
  });

  // ==========================================================================
  // getRunHistory
  // ==========================================================================

  describe("getRunHistory", () => {
    test("should return empty array when CLI fails", async () => {
      mockShouldFail = true;
      const runs = await CronService.getRunHistory("no-such-job-xyz");
      expect(runs).toEqual([]);
    });

    test("should return mapped run entries for a job", async () => {
      const runs = await CronService.getRunHistory("job-1");
      expect(Array.isArray(runs)).toBe(true);
      expect(runs.length).toBe(2);
      expect(runs[0].status).toBe("success");
      expect(runs[0].jobId).toBe("job-1");
      expect(runs[1].status).toBe("timeout");
      expect(runs[1].error).toBe("Timed out after 30s");
    });

    test("should return empty array when entries is missing", async () => {
      mockRunsResponse = JSON.stringify({});
      const runs = await CronService.getRunHistory("job-1");
      expect(runs).toEqual([]);
    });
  });

  // ==========================================================================
  // mapRunStatus
  // ==========================================================================

  describe("mapRunStatus", () => {
    test("should map 'ok' to 'success'", () => {
      expect(CronService.mapRunStatus("ok")).toBe("success");
    });

    test("should map 'success' to 'success'", () => {
      expect(CronService.mapRunStatus("success")).toBe("success");
    });

    test("should map 'pending' to 'pending'", () => {
      expect(CronService.mapRunStatus("pending")).toBe("pending");
    });

    test("should map 'cancelled' to 'cancelled'", () => {
      expect(CronService.mapRunStatus("cancelled")).toBe("cancelled");
    });

    test("should map 'timeout' to 'timeout'", () => {
      expect(CronService.mapRunStatus("timeout")).toBe("timeout");
    });

    test("should map unknown status to 'failure'", () => {
      expect(CronService.mapRunStatus("error")).toBe("failure");
      expect(CronService.mapRunStatus("crashed")).toBe("failure");
      expect(CronService.mapRunStatus("")).toBe("failure");
    });
  });

  // ==========================================================================
  // enrichJob
  // ==========================================================================

  describe("enrichJob", () => {
    test("should add human-readable schedule for cron", () => {
      const job = makeJob({ schedule: { kind: "cron", expr: "0 * * * *" } });
      const enriched = CronService.enrichJob(job);
      expect(enriched.scheduleHuman).toBeTruthy();
      expect(enriched.scheduleHuman!.toLowerCase()).toContain("every hour");
      expect(enriched.nextRun).toBe("scheduled");
    });

    test("should add human-readable schedule for interval", () => {
      const job = makeJob({ schedule: { kind: "every", everyMs: 300000 } });
      const enriched = CronService.enrichJob(job);
      expect(enriched.scheduleHuman).toContain("5 minutes");
      expect(enriched.nextRun).toContain("~5m");
    });

    test("should add human-readable schedule for 'at' (future)", () => {
      const futureDate = new Date(Date.now() + 3600000).toISOString();
      const job = makeJob({ schedule: { kind: "at", at: futureDate } });
      const enriched = CronService.enrichJob(job);
      expect(enriched.scheduleHuman).toContain("Once at");
      expect(enriched.nextRun).toContain("in");
    });

    test("should add human-readable schedule for 'at' (past)", () => {
      const pastDate = new Date(Date.now() - 3600000).toISOString();
      const job = makeJob({ schedule: { kind: "at", at: pastDate } });
      const enriched = CronService.enrichJob(job);
      expect(enriched.nextRun).toBe("past");
    });

    test("should format last run from state", () => {
      const job = makeJob({
        state: { lastRunAtMs: Date.now() - 60000 },
      });
      const enriched = CronService.enrichJob(job);
      expect(enriched.lastRun).toBeTruthy();
    });

    test("should not set lastRun when state has no lastRunAtMs", () => {
      const job = makeJob({ state: {} });
      const enriched = CronService.enrichJob(job);
      expect(enriched.lastRun).toBeUndefined();
    });
  });

  // ==========================================================================
  // formatSchedule
  // ==========================================================================

  describe("formatSchedule", () => {
    test("should format cron expression", () => {
      const result = CronService.formatSchedule({
        kind: "cron",
        expr: "*/5 * * * *",
      });
      expect(result.toLowerCase()).toContain("5 minutes");
    });

    test("should format cron with timezone", () => {
      const result = CronService.formatSchedule({
        kind: "cron",
        expr: "0 9 * * *",
        tz: "America/New_York",
      });
      expect(result).toContain("America/New_York");
    });

    test("should format 'every' schedule", () => {
      const result = CronService.formatSchedule({
        kind: "every",
        everyMs: 300000,
      });
      expect(result).toContain("5 minutes");
    });

    test("should format 'at' schedule", () => {
      const result = CronService.formatSchedule({
        kind: "at",
        at: "2025-06-15T12:00:00Z",
      });
      expect(result).toContain("Once at");
    });

    test("should return 'Unknown' for unknown schedule kind", () => {
      const result = CronService.formatSchedule({
        kind: "unknown" as any,
      } as any);
      expect(result).toBe("Unknown");
    });
  });

  // ==========================================================================
  // formatIntervalSchedule
  // ==========================================================================

  describe("formatIntervalSchedule", () => {
    test("should format seconds", () => {
      expect(CronService.formatIntervalSchedule(30000)).toBe(
        "Every 30 seconds",
      );
    });

    test("should format minutes", () => {
      expect(CronService.formatIntervalSchedule(300000)).toBe(
        "Every 5 minutes",
      );
    });

    test("should format hours", () => {
      expect(CronService.formatIntervalSchedule(7200000)).toBe("Every 2 hours");
    });

    test("should format days", () => {
      expect(CronService.formatIntervalSchedule(86400000)).toBe("Every 1 days");
    });
  });

  // ==========================================================================
  // formatCronExpression
  // ==========================================================================

  describe("formatCronExpression", () => {
    test("should format valid cron expression", () => {
      const result = CronService.formatCronExpression("0 * * * *");
      expect(result.toLowerCase()).toContain("every hour");
    });

    test("should include timezone if provided", () => {
      const result = CronService.formatCronExpression(
        "0 9 * * *",
        "America/Chicago",
      );
      expect(result).toContain("America/Chicago");
    });

    test("should fallback to raw expression for invalid cron", () => {
      const result = CronService.formatCronExpression("not-valid");
      expect(result).toBe("not-valid");
    });
  });

  // ==========================================================================
  // formatAtSchedule
  // ==========================================================================

  describe("formatAtSchedule", () => {
    test("should format valid ISO date", () => {
      const result = CronService.formatAtSchedule("2025-01-01T12:00:00Z");
      expect(result).toContain("Once at");
    });

    test("should handle arbitrary string", () => {
      const result = CronService.formatAtSchedule("some-date-string");
      expect(result).toContain("Once at");
    });
  });

  // ==========================================================================
  // calculateNextRun
  // ==========================================================================

  describe("calculateNextRun", () => {
    test("should return future time for 'at' schedule (minutes)", () => {
      const futureDate = new Date(Date.now() + 1800000).toISOString();
      const result = CronService.calculateNextRun({
        kind: "at",
        at: futureDate,
      });
      expect(result).toContain("in");
      expect(result).toContain("m");
    });

    test("should return future time for 'at' schedule (hours)", () => {
      const futureDate = new Date(Date.now() + 5 * 3600000).toISOString();
      const result = CronService.calculateNextRun({
        kind: "at",
        at: futureDate,
      });
      expect(result).toContain("in");
      expect(result).toContain("h");
    });

    test("should return future time for 'at' schedule (days)", () => {
      const futureDate = new Date(Date.now() + 3 * 24 * 3600000).toISOString();
      const result = CronService.calculateNextRun({
        kind: "at",
        at: futureDate,
      });
      expect(result).toContain("in");
      expect(result).toContain("d");
    });

    test("should return 'past' for past 'at' schedule", () => {
      const pastDate = new Date(Date.now() - 3600000).toISOString();
      const result = CronService.calculateNextRun({
        kind: "at",
        at: pastDate,
      });
      expect(result).toBe("past");
    });

    test("should return approximate time for 'every' in minutes", () => {
      const result = CronService.calculateNextRun({
        kind: "every",
        everyMs: 300000,
      });
      expect(result).toBe("in ~5m");
    });

    test("should return approximate time for 'every' in hours", () => {
      const result = CronService.calculateNextRun({
        kind: "every",
        everyMs: 7200000,
      });
      expect(result).toBe("in ~2h");
    });

    test("should return approximate time for 'every' in days", () => {
      const result = CronService.calculateNextRun({
        kind: "every",
        everyMs: 172800000,
      });
      expect(result).toBe("in ~2d");
    });

    test("should return 'scheduled' for cron schedule", () => {
      const result = CronService.calculateNextRun({
        kind: "cron",
        expr: "0 * * * *",
      });
      expect(result).toBe("scheduled");
    });
  });

  // ==========================================================================
  // enableJob
  // ==========================================================================

  describe("enableJob", () => {
    test("should return true on success", async () => {
      const result = await CronService.enableJob("job-1");
      expect(result).toBe(true);
    });

    test("should call CLI with correct args", async () => {
      await CronService.enableJob("job-1");
      expect(lastExecArgs).toContain("cron");
      expect(lastExecArgs).toContain("enable");
      expect(lastExecArgs).toContain("--id");
      expect(lastExecArgs).toContain("job-1");
    });

    test("should pass gateway args", async () => {
      await CronService.enableJob("job-1", {
        gatewayUrl: "https://gw.test",
        gatewayToken: "tok123",
      });
      expect(lastExecArgs).toContain("--url");
      expect(lastExecArgs).toContain("https://gw.test");
      expect(lastExecArgs).toContain("--token");
      expect(lastExecArgs).toContain("tok123");
    });

    test("should return false on CLI failure", async () => {
      mockShouldFail = true;
      const result = await CronService.enableJob("job-1");
      expect(result).toBe(false);
    });
  });

  // ==========================================================================
  // disableJob
  // ==========================================================================

  describe("disableJob", () => {
    test("should return true on success", async () => {
      const result = await CronService.disableJob("job-1");
      expect(result).toBe(true);
    });

    test("should call CLI with correct args", async () => {
      await CronService.disableJob("job-1");
      expect(lastExecArgs).toContain("cron");
      expect(lastExecArgs).toContain("disable");
      expect(lastExecArgs).toContain("--id");
      expect(lastExecArgs).toContain("job-1");
    });

    test("should return false on CLI failure", async () => {
      mockShouldFail = true;
      const result = await CronService.disableJob("job-1");
      expect(result).toBe(false);
    });
  });

  // ==========================================================================
  // runJob
  // ==========================================================================

  describe("runJob", () => {
    test("should return true on success", async () => {
      const result = await CronService.runJob("job-1");
      expect(result).toBe(true);
    });

    test("should call CLI with correct args", async () => {
      await CronService.runJob("job-1");
      expect(lastExecArgs).toContain("cron");
      expect(lastExecArgs).toContain("run");
      expect(lastExecArgs).toContain("--id");
      expect(lastExecArgs).toContain("job-1");
    });

    test("should return false on CLI failure", async () => {
      mockShouldFail = true;
      const result = await CronService.runJob("job-1");
      expect(result).toBe(false);
    });
  });

  // ==========================================================================
  // deleteJob
  // ==========================================================================

  describe("deleteJob", () => {
    test("should return true on success", async () => {
      const result = await CronService.deleteJob("job-1");
      expect(result).toBe(true);
    });

    test("should call CLI with 'rm' subcommand", async () => {
      await CronService.deleteJob("job-1");
      expect(lastExecArgs).toContain("cron");
      expect(lastExecArgs).toContain("rm");
      expect(lastExecArgs).toContain("--id");
      expect(lastExecArgs).toContain("job-1");
    });

    test("should return false on CLI failure", async () => {
      mockShouldFail = true;
      const result = await CronService.deleteJob("job-1");
      expect(result).toBe(false);
    });
  });

  // ==========================================================================
  // clearCache
  // ==========================================================================

  describe("clearCache", () => {
    test("should not throw", () => {
      expect(() => CronService.clearCache()).not.toThrow();
    });
  });

  // ==========================================================================
  // getJobsFilePath (deprecated, kept for compatibility)
  // ==========================================================================

  describe("getJobsFilePath", () => {
    test("should return a path ending in jobs.json", () => {
      const p = CronService.getJobsFilePath();
      expect(p).toContain("jobs.json");
      expect(p).toContain(".openclaw-team/cron");
    });

    test("should throw when HOME is not set", () => {
      const origHome = process.env.HOME;
      try {
        delete process.env.HOME;
        expect(() => CronService.getJobsFilePath()).toThrow(
          "HOME environment variable is not set",
        );
      } finally {
        process.env.HOME = origHome;
      }
    });
  });
});

// Utility to create a minimal CronJob object for testing
function makeJob(overrides: Partial<CronJob> = {}): CronJob {
  return {
    id: "test-job",
    name: "Test Job",
    schedule: { kind: "cron", expr: "0 * * * *" },
    payload: { kind: "systemEvent", text: "test" },
    sessionTarget: "main",
    enabled: true,
    ...overrides,
  };
}
