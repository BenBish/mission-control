import { execFile as _execFile } from "child_process";
import { promisify } from "util";
import cronstrue from "cronstrue";
import { CronJob, RunHistory } from "@/types/cron";

const _execFileAsync = promisify(_execFile);

/**
 * Wrapper around promisified execFile. Exposed for test mocking via
 * `CronService._execFileAsync`. Production code should not override this.
 */
let execFileAsync = _execFileAsync;

export interface GatewayOptions {
  gatewayUrl?: string;
  gatewayToken?: string;
  profileId?: string;
}

interface CachedJobs {
  data: CronJob[];
  timestamp: number;
}

/** Per-profile job cache keyed by profileId (or "__default__" for no-profile calls). */
const cachedJobsByProfile: Map<string, CachedJobs> = new Map();
const CACHE_TTL_MS = 5000;

/**
 * Build CLI args for targeting a specific gateway.
 * Uses env vars CRON_GATEWAY_URL and CRON_GATEWAY_TOKEN when set,
 * allowing Mission Control to query any gateway (personal or team).
 *
 * When `gatewayUrl` and `gatewayToken` are provided explicitly
 * (e.g. for multi-profile support), they take precedence over env vars.
 */
function getGatewayArgs(options?: GatewayOptions): string[] {
  const args: string[] = [];

  // Prefer --profile when available — lets the CLI handle discovery
  // (avoids needing to extract tokens from systemd service files)
  if (options?.profileId && options.profileId !== "all") {
    args.push("--profile", options.profileId);
    return args;
  }

  const url = options?.gatewayUrl || process.env.CRON_GATEWAY_URL;
  const token = options?.gatewayToken || process.env.CRON_GATEWAY_TOKEN;
  if (url) args.push("--url", url);
  if (token) args.push("--token", token);
  return args;
}

/**
 * Run an openclaw CLI command and return parsed JSON output.
 * Uses async execFile to avoid blocking the event loop.
 * Falls back to null on any error (CLI not installed, gateway down, etc.)
 */
async function runOpenclawJson<T>(args: string[]): Promise<T | null> {
  try {
    const { stdout, stderr } = await execFileAsync("openclaw", args, {
      encoding: "utf-8",
      timeout: 15_000,
      env: { ...process.env },
    });
    if (!stdout) {
      console.error("openclaw CLI error:", stderr?.trim() || "no output");
      return null;
    }
    return JSON.parse(stdout) as T;
  } catch (error: unknown) {
    // execFile rejects on non-zero exit or timeout
    const err = error as Record<string, unknown>;
    if (typeof err.stderr === "string" && err.stderr) {
      console.error("openclaw CLI error:", err.stderr.trim());
    } else {
      console.error(
        "Failed to run openclaw CLI:",
        error instanceof Error ? error.message : error,
      );
    }
    return null;
  }
}

interface CliJobsResponse {
  jobs: CronJob[];
  total: number;
}

interface CliRunsResponse {
  entries: Array<{
    ts: number;
    jobId: string;
    action: string;
    status: string;
    summary?: string;
    error?: string;
    runAtMs: number;
    durationMs: number;
    nextRunAtMs?: number;
    sessionId?: string;
    sessionKey?: string;
  }>;
}

export class CronService {
  /**
   * @deprecated Kept for backward compatibility with tests.
   * Returns a placeholder path; actual data now comes from the gateway API.
   */
  static getJobsFilePath(): string {
    const home = process.env.HOME;
    if (!home) {
      throw new Error("HOME environment variable is not set");
    }
    return `${home}/.openclaw-team/cron/jobs.json`;
  }

  static async getJobs(gateway?: GatewayOptions): Promise<CronJob[]> {
    // Per-profile cache key
    const cacheKey = gateway?.gatewayUrl ?? "__default__";

    // Check cache
    const cached = cachedJobsByProfile.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.data;
    }

    const gatewayArgs = getGatewayArgs(gateway);
    const response = await runOpenclawJson<CliJobsResponse>([
      "cron",
      "list",
      "--all",
      "--json",
      ...gatewayArgs,
    ]);

    if (!response) {
      // CLI unavailable or gateway down — return empty list
      return [];
    }

    const jobs: CronJob[] = Array.isArray(response.jobs) ? response.jobs : [];

    // Enrich jobs
    const enriched = jobs.map((job) => this.enrichJob(job));

    // Update cache
    cachedJobsByProfile.set(cacheKey, {
      data: enriched,
      timestamp: Date.now(),
    });
    return enriched;
  }

  static async getJob(
    id: string,
    gateway?: GatewayOptions,
  ): Promise<CronJob | null> {
    const jobs = await this.getJobs(gateway);
    return jobs.find((j) => j.id === id) || null;
  }

  static async getRunHistory(
    jobId: string,
    limit = 20,
    gateway?: GatewayOptions,
  ): Promise<RunHistory[]> {
    const gatewayArgs = getGatewayArgs(gateway);
    // Note: `cron runs` outputs JSON by default (no --json flag needed),
    // unlike `cron list` which requires the explicit `--json` flag.
    const response = await runOpenclawJson<CliRunsResponse>([
      "cron",
      "runs",
      "--id",
      jobId,
      "--limit",
      String(limit),
      ...gatewayArgs,
    ]);

    if (!response || !Array.isArray(response.entries)) {
      return [];
    }

    // Map CLI entries to RunHistory type.
    // Status mapping: ok/success → "success", pending → "pending",
    // cancelled/timeout get their own values, everything else → "failure".
    return response.entries.map((entry) => ({
      id: entry.sessionId || `${entry.jobId}-${entry.ts}`,
      jobId: entry.jobId,
      timestamp: entry.ts,
      status: this.mapRunStatus(entry.status),
      duration: entry.durationMs,
      output: entry.summary,
      error: entry.error,
    }));
  }

  static mapRunStatus(
    status: string,
  ): "success" | "failure" | "pending" | "cancelled" | "timeout" {
    switch (status) {
      case "ok":
      case "success":
        return "success";
      case "pending":
        return "pending";
      case "cancelled":
        return "cancelled";
      case "timeout":
        return "timeout";
      default:
        return "failure";
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
    cachedJobsByProfile.clear();
  }

  /**
   * @internal Override the execFile implementation for testing.
   * Pass `null` to restore the default.
   */
  static _setExecFileAsync(fn: typeof _execFileAsync | null): void {
    execFileAsync = fn ?? _execFileAsync;
  }
}
