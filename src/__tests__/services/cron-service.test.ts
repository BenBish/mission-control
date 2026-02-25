/**
 * CronService Tests
 * Tests cron job listing, enrichment, schedule formatting, and cache behavior.
 *
 * getJobs() now queries the gateway via `openclaw cron list --all --json`.
 * Tests that exercise getJobs/getJob/getRunHistory rely on the real CLI being
 * available; they gracefully handle empty results when the gateway is down.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { CronService } from "../../services/cron-service.js";
import type { CronJob } from "../../types/cron.js";

describe("CronService", () => {
  beforeEach(() => {
    CronService.clearCache();
  });

  // ==========================================================================
  // getJobs - queries gateway via CLI
  // ==========================================================================

  describe("getJobs", () => {
    test("should return an array of jobs (from gateway CLI)", async () => {
      const jobs = await CronService.getJobs();
      expect(Array.isArray(jobs)).toBe(true);
      // Whatever the gateway returns — just check enrichment if any jobs exist
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
      // Should still be equal content (same gateway)
      expect(first.length).toBe(second.length);
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
      const jobs = await CronService.getJobs();
      if (jobs.length > 0) {
        const found = await CronService.getJob(jobs[0].id);
        expect(found).toBeTruthy();
        expect(found!.id).toBe(jobs[0].id);
      }
    });
  });

  // ==========================================================================
  // getRunHistory
  // ==========================================================================

  describe("getRunHistory", () => {
    test("should return empty array for non-existent job runs", async () => {
      const runs = await CronService.getRunHistory("no-such-job-xyz");
      expect(runs).toEqual([]);
    });

    test("should return array (possibly empty) for any job", async () => {
      const jobs = await CronService.getJobs();
      if (jobs.length > 0) {
        const runs = await CronService.getRunHistory(jobs[0].id);
        expect(Array.isArray(runs)).toBe(true);
      }
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
      expect(p).toContain(".openclaw/cron");
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
