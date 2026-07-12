/**
 * Ingest wire contract — shared between the server (src/api/routes/ingest.ts,
 * services/ingest-service.ts) and every collector (src/collectors/**).
 *
 * A collector never talks to SQLite directly. It emits IngestEvents, batches
 * them, and hands the batch to a Sink (HttpSink over the network, LocalSink
 * for server-side pollers). The server dedupes on (sourceId, instanceId,
 * kind, naturalKey) via the `ingest_dedupe` table — see src/db/schema.ts.
 *
 * naturalKey must be stable across restarts and re-scans (e.g. derived from
 * a JSONL file path + record uuid, not from an insertion counter).
 */

export type IngestEventKind =
  | "session"
  | "activity"
  | "inference_request"
  | "runtime_snapshot"
  | "runtime_event"
  | "quota_snapshot"
  | "generation_job"
  | "job_run";

export type ActorType = "user" | "agent" | "subagent" | "system";

export type ActionType =
  | "tool_call"
  | "delegation"
  | "api_call"
  | "decision"
  | "message"
  | "event"
  | "user_request"
  | "agent_spawn"
  | "session_start"
  | "session_end";

export interface SessionPayload {
  externalId: string;
  cwd?: string;
  gitBranch?: string;
  title?: string;
  clientVersion?: string;
  modelProvider?: string;
  startedAt: string;
  endedAt?: string;
  turnCount?: number;
  toolCallCount?: number;
  failureCount?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  /** Only set for genuinely billable sources. Never fabricate a dollar figure. */
  costUsd?: number;
}

export interface ActivityPayload {
  /** external_id of the owning session (resolved server-side to sessions.id) */
  sessionExternalId: string;
  externalId?: string;
  /** parentUuid-style linkage — subagent/sidechain lanes */
  parentExternalId?: string;
  timestamp: string;
  completedAt?: string;
  durationMs?: number;
  actorType: ActorType;
  actorId: string;
  actorRole?: string;
  actorSessionLabel?: string;
  actionType: ActionType;
  toolName?: string;
  description: string;
  details?: unknown;
  status: string;
  result?: unknown;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  model?: string;
  costUsd?: number;
  requestId?: string;
  tags?: string;
  metadata?: unknown;
}

export type InferenceStatus =
  | "success"
  | "cancelled"
  | "context_overflow"
  | "error";
export type Workload = "foreground" | "background" | "unknown";

export interface InferenceRequestPayload {
  externalId?: string;
  timestamp: string;
  model?: string;
  endpoint?: string;
  /** e.g. 'tom' | 'freddy' | 'opencode' — gateway/consumer of origin */
  clientLabel?: string;
  workload?: Workload;
  promptTokens?: number;
  completionTokens?: number;
  cachedTokens?: number;
  ttftMs?: number;
  durationMs?: number;
  tokensPerSec?: number;
  slotId?: number;
  status: InferenceStatus;
  error?: string;
  details?: unknown;
}

export type RuntimeSnapshotKind = "slots" | "health" | "system" | "models";

export interface RuntimeSnapshotPayload {
  timestamp: string;
  kind: RuntimeSnapshotKind;
  slotsTotal?: number;
  slotsBusy?: number;
  modelsLoaded?: unknown;
  healthy?: boolean;
  payload?: unknown;
}

export type RuntimeEventKind =
  | "slots_saturated"
  | "model_load"
  | "model_unload"
  | "service_down"
  | "service_up"
  | "context_overflow"
  | "request_cancelled";

export interface RuntimeEventPayload {
  timestamp: string;
  endedAt?: string;
  kind: RuntimeEventKind;
  severity?: "info" | "warning" | "error";
  summary: string;
  details?: unknown;
}

export interface QuotaSnapshotPayload {
  timestamp: string;
  /** Codex rate_limits.limit_id, e.g. 'primary' | 'secondary' */
  limitId: string;
  usedPercent: number;
  windowMinutes?: number;
  resetsAt?: string;
}

export type GenerationJobStatus =
  | "queued"
  | "running"
  | "success"
  | "error"
  | "interrupted";

export interface GenerationJobPayload {
  externalId: string;
  status: GenerationJobStatus;
  /** Poller-observed, never claimed as the true queue time */
  firstSeenAt: string;
  observedStartedAt?: string;
  observedCompletedAt?: string;
  workflowHash?: string;
  nodeCount?: number;
  outputCount?: number;
  details?: unknown;
}

export type JobRunStatus =
  | "success"
  | "failure"
  | "cancelled"
  | "timeout"
  | "running";

export interface JobRunPayload {
  /** background_jobs.id, e.g. 'hermes:compression', 'collector:claude-code@arch-desktop' */
  jobId: string;
  /** Upserts background_jobs if this id hasn't been seen before */
  jobName?: string;
  jobKind?: "inferred" | "collector" | "scheduled";
  startedAt: string;
  endedAt?: string;
  status: JobRunStatus;
  durationMs?: number;
  output?: string;
  error?: string;
  details?: unknown;
}

export type IngestPayload =
  | SessionPayload
  | ActivityPayload
  | InferenceRequestPayload
  | RuntimeSnapshotPayload
  | RuntimeEventPayload
  | QuotaSnapshotPayload
  | GenerationJobPayload
  | JobRunPayload;

export interface IngestEvent {
  kind: IngestEventKind;
  /** Stable across restarts/re-scans — see file header. */
  naturalKey: string;
  payload: IngestPayload;
}

export interface IngestBatch {
  sourceId: string;
  instanceId: string;
  collectorVersion: string;
  sentAt: string;
  events: IngestEvent[];
}

export interface IngestRejection {
  index: number;
  error: string;
}

export interface IngestAck {
  accepted: number;
  duplicates: number;
  rejected: IngestRejection[];
}

export interface Sink {
  send(batch: IngestBatch): Promise<IngestAck>;
}
