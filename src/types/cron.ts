export type ScheduleKind = "cron" | "every" | "at";
export type PayloadKind = "systemEvent" | "agentTurn";
export type JobStatus = "idle" | "running" | "completed" | "failed";

export interface CronSchedule {
  kind: "cron";
  expr: string;
  tz?: string;
}

export interface EverySchedule {
  kind: "every";
  everyMs: number;
  anchorMs?: number;
}

export interface AtSchedule {
  kind: "at";
  at: string;
}

export type ScheduleConfig = CronSchedule | EverySchedule | AtSchedule;

export interface SystemEventPayload {
  kind: "systemEvent";
  text: string;
}

export interface AgentTurnPayload {
  kind: "agentTurn";
  message: string;
  model?: string;
  thinking?: string;
  timeoutSeconds?: number;
}

export type PayloadConfig = SystemEventPayload | AgentTurnPayload;

export interface CronJobState {
  lastRunAtMs?: number;
  lastRunStatus?: "success" | "failure";
  nextWakeAtMs?: number;
  // Fields returned by the gateway API
  lastStatus?: string;
  lastDurationMs?: number;
  consecutiveErrors?: number;
  lastError?: string;
  nextRunAtMs?: number;
}

export interface CronJob {
  id: string;
  name: string;
  agentId?: string;
  schedule: ScheduleConfig;
  payload: PayloadConfig;
  delivery?: {
    mode: string;
    channel?: string;
    to?: string;
    bestEffort?: boolean;
  };
  sessionTarget: string;
  enabled: boolean;
  notify?: boolean;
  wakeMode?: string;
  model?: string;
  thinking?: string;
  createdAt?: string;
  updatedAt?: string;
  createdAtMs?: number;
  updatedAtMs?: number;
  state?: CronJobState;
  // Enriched fields
  scheduleHuman?: string;
  nextRun?: string;
  lastRun?: string;
}

export interface RunHistory {
  id: string;
  jobId: string;
  timestamp: number;
  status: "success" | "failure";
  duration?: number;
  output?: string;
  error?: string;
}

export interface CronMutationResponse {
  success: boolean;
  message?: string;
  data?: unknown;
}
