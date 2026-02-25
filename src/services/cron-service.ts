import fs from "fs";
import path from "path";
import cronstrue from "cronstrue";
import { CronJob, RunHistory } from "@/types/cron";

interface CachedJobs {
  data: CronJob[];
  timestamp: number;
}

let cachedJobs: CachedJobs | null = null;
const CACHE_TTL_MS = 5000;

function getJobsFile(): string {
  return path.join(
    process.env.HOME || "/home/ben",
    ".openclaw/cron/jobs.json",
  );
}

export class CronService {
  static getJobsFilePath(): string {
    return getJobsFile();
  }

  static async getJobs(): Promise<CronJob[]> {
    // Check cache
    if (cachedJobs && Date.now() - cachedJobs.timestamp < CACHE_TTL_MS) {
      return cachedJobs.data;
    }

    try {
      const jobsFile = getJobsFile();
      if (!fs.existsSync(jobsFile)) {
        return [];
      }

      const content = fs.readFileSync(jobsFile, "utf-8");
      const raw = JSON.parse(content);
      const jobs: CronJob[] = Array.isArray(raw) ? raw : raw.jobs || [];

      // Enrich jobs
      const enriched = jobs.map((job) => this.enrichJob(job));

      // Update cache
      cachedJobs = { data: enriched, timestamp: Date.now() };
      return enriched;
    } catch (error) {
      console.error("Error reading cron jobs:", error);
      throw error;
    }
  }

  static async getJob(id: string): Promise<CronJob | null> {
    const jobs = await this.getJobs();
    return jobs.find((j) => j.id === id) || null;
  }

  static async getRunHistory(jobId: string, limit = 20): Promise<RunHistory[]> {
    try {
      const runsFile = path.join(
        path.dirname(getJobsFile()),
        `runs-${jobId}.jsonl`,
      );
      if (!fs.existsSync(runsFile)) {
        return [];
      }

      const content = fs.readFileSync(runsFile, "utf-8");
      const lines = content
        .split("\n")
        .filter((l) => l.trim())
        .slice(-limit);

      return lines.map((line) => JSON.parse(line) as RunHistory);
    } catch (error) {
      console.error("Error reading run history:", error);
      return [];
    }
  }

  static enrichJob(job: CronJob): CronJob {
    const enriched = { ...job };

    // Format schedule
    enriched.scheduleHuman = this.formatSchedule(job.schedule);

    // Calculate next run
    enriched.nextRun = this.calculateNextRun(job.schedule);

    // Format last run
    if (job.state?.lastRunAtMs) {
      const date = new Date(job.state.lastRunAtMs);
      enriched.lastRun = date.toLocaleString();
    }

    return enriched;
  }

  static formatSchedule(schedule: CronJob["schedule"]): string {
    if (schedule.kind === "cron") {
      return this.formatCronExpression(schedule.expr, schedule.tz);
    } else if (schedule.kind === "every") {
      return this.formatIntervalSchedule(schedule.everyMs);
    } else if (schedule.kind === "at") {
      return this.formatAtSchedule(schedule.at);
    }
    return "Unknown";
  }

  static formatCronExpression(expr: string, tz?: string): string {
    try {
      return cronstrue.toString(expr) + (tz ? ` ${tz}` : "");
    } catch {
      return expr; // fallback to raw expression
    }
  }

  static formatIntervalSchedule(ms: number): string {
    const secs = ms / 1000;
    if (secs < 60) return `Every ${Math.round(secs)} seconds`;
    const mins = secs / 60;
    if (mins < 60) return `Every ${Math.round(mins)} minutes`;
    const hours = mins / 60;
    if (hours < 24) return `Every ${Math.round(hours)} hours`;
    const days = hours / 24;
    return `Every ${Math.round(days)} days`;
  }

  static formatAtSchedule(at: string): string {
    try {
      const date = new Date(at);
      return `Once at ${date.toLocaleString()}`;
    } catch {
      return `Once at ${at}`;
    }
  }

  static calculateNextRun(schedule: CronJob["schedule"]): string {
    if (schedule.kind === "at") {
      try {
        const date = new Date(schedule.at);
        const now = new Date();
        if (date > now) {
          const diff = date.getTime() - now.getTime();
          const mins = Math.round(diff / 60000);
          if (mins < 60) return `in ${mins}m`;
          const hours = Math.round(mins / 60);
          if (hours < 24) return `in ${hours}h`;
          return `in ${Math.round(hours / 24)}d`;
        }
        return "past";
      } catch {
        return "unknown";
      }
    }
    if (schedule.kind === "every") {
      const ms = schedule.everyMs;
      const mins = ms / 60000;
      if (mins < 60) return `in ~${Math.round(mins)}m`;
      const hours = mins / 60;
      if (hours < 24) return `in ~${Math.round(hours)}h`;
      return `in ~${Math.round(hours / 24)}d`;
    }
    return "scheduled";
  }

  static clearCache(): void {
    cachedJobs = null;
  }
}
