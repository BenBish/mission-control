/**
 * Archie State Service
 * Reads Archie's task state from ~/.openclaw-archie/state/tasks/{task}/status.json
 */

import * as fs from "fs/promises";
import { existsSync } from "fs";
import * as path from "path";
import * as os from "os";

/** Shape of a status.json file in Archie's task state directory */
export interface ArchieTaskStatus {
  task_id: string;
  title: string;
  state: string;
  kind?: string;
  branch?: string;
  priority?: string;
  created_at: string;
  updated_at: string;
  owner?: string;
  linear?: {
    issue_id?: string;
    url?: string | null;
  };
  pr?: {
    number?: number | null;
    url?: string | null;
    head_ref?: string | null;
  };
  result?: {
    summary?: string | null;
    last_error?: string | null;
    blocked_reason?: string | null;
  };
  worker?: {
    pid?: number | null;
    session_name?: string;
    started_at?: string;
    last_heartbeat_at?: string;
    exit_code?: number | null;
  };
  usage?: {
    totals?: {
      cost_usd?: number;
      num_turns?: number;
      input_tokens?: number;
      output_tokens?: number;
    };
  };
}

/** Archie's overall status derived from task states */
export type ArchieOverallStatus = "idle" | "working" | "reviewing" | "testing";

/** Response shape for the archie status endpoint */
export interface ArchieStatusResponse {
  overall_status: ArchieOverallStatus;
  current_task: ArchieTaskStatus | null;
  recent_tasks: ArchieTaskStatus[];
}

// States that indicate Archie is actively working
const ACTIVE_STATES = new Set([
  "running",
  "in_progress",
  "awaiting_ci",
  "retry_planned",
]);
const REVIEW_STATES = new Set(["awaiting_review", "awaiting_pr"]);
const TESTING_STATES = new Set(["testing"]);

function getArchieStateDir(): string {
  return (
    process.env.ARCHIE_STATE_DIR ||
    path.join(os.homedir(), ".openclaw-archie", "state", "tasks")
  );
}

export class ArchieStateService {
  /**
   * Read all task status files from Archie's state directory
   */
  async readAllTasks(): Promise<ArchieTaskStatus[]> {
    const stateDir = getArchieStateDir();
    if (!existsSync(stateDir)) {
      return [];
    }

    const tasks: ArchieTaskStatus[] = [];

    try {
      const taskDirs = await fs.readdir(stateDir);
      for (const taskDir of taskDirs) {
        const statusPath = path.join(stateDir, taskDir, "status.json");
        if (!existsSync(statusPath)) continue;

        try {
          const content = await fs.readFile(statusPath, "utf-8");
          const status = JSON.parse(content) as ArchieTaskStatus;
          tasks.push(status);
        } catch (err) {
          console.warn(
            `[ArchieStateService] Failed to parse ${statusPath}:`,
            err,
          );
        }
      }
    } catch (err) {
      console.warn(`[ArchieStateService] Failed to read ${stateDir}:`, err);
    }

    // Sort by updated_at descending (most recent first)
    tasks.sort(
      (a, b) =>
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    );

    return tasks;
  }

  /**
   * Get Archie's current status: overall status, current task, and recent tasks
   */
  async getStatus(): Promise<ArchieStatusResponse> {
    const tasks = await this.readAllTasks();

    // Find the current active task (most recently updated non-terminal task)
    const currentTask =
      tasks.find(
        (t) =>
          ACTIVE_STATES.has(t.state) ||
          REVIEW_STATES.has(t.state) ||
          TESTING_STATES.has(t.state),
      ) || null;

    // Derive overall status from the current task
    let overall_status: ArchieOverallStatus = "idle";
    if (currentTask) {
      if (ACTIVE_STATES.has(currentTask.state)) {
        overall_status = "working";
      } else if (REVIEW_STATES.has(currentTask.state)) {
        overall_status = "reviewing";
      } else if (TESTING_STATES.has(currentTask.state)) {
        overall_status = "testing";
      }
    }

    // Return the 5 most recent tasks
    const recent_tasks = tasks.slice(0, 5);

    return {
      overall_status,
      current_task: currentTask,
      recent_tasks,
    };
  }

  /**
   * Derive an agent-compatible status from Archie's task state.
   * Maps archie states → standard agent statuses used by the dashboard.
   */
  deriveAgentStatus(
    archieStatus: ArchieStatusResponse,
  ): "online" | "offline" | "busy" | "idle" {
    if (!archieStatus.current_task) {
      // Check if there's any recent activity (within last 30 min)
      const recentTask = archieStatus.recent_tasks[0];
      if (recentTask) {
        const updatedAt = new Date(recentTask.updated_at).getTime();
        const diffMins = (Date.now() - updatedAt) / 60000;
        if (diffMins < 5) return "idle";
        if (diffMins < 30) return "idle";
      }
      return "offline";
    }

    // Has an active task
    switch (archieStatus.overall_status) {
      case "working":
      case "testing":
        return "online";
      case "reviewing":
        return "busy";
      default:
        return "idle";
    }
  }
}
