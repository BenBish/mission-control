/**
 * Ingest service — validates, dedupes, and upserts IngestEvents from any
 * collector (JSONL push from Claude Code/Codex, HTTP poll from Hermes/
 * Lemonade/ComfyUI). Replaces both the old ActivityLogger's write path and
 * the OpenClaw-shaped POST /api/activities mapping.
 */

import { EventEmitter } from "events";
import { z } from "zod";
import type { Database as SqliteDatabase } from "sqlite";
import type {
  IngestBatch,
  IngestEvent,
  IngestAck,
  IngestRejection,
  Heartbeat,
  SessionPayload,
  ActivityPayload,
  InferenceRequestPayload,
  RuntimeSnapshotPayload,
  RuntimeEventPayload,
  QuotaSnapshotPayload,
  GenerationJobPayload,
  JobRunPayload,
} from "../../types/ingest.js";
import {
  checkAndRecordDedupe,
  getDedupeEntityId,
  releaseDedupe,
  setDedupeEntityId,
} from "../../db/queries/dedupe.js";
import {
  upsertSession,
  ensureSessionPlaceholder,
  touchSessionActivity,
  sessionId as computeSessionId,
} from "../../db/queries/sessions.js";
import { insertActivity, rowToActivity } from "../../db/queries/activities.js";
import {
  insertInferenceRequest,
  insertRuntimeSnapshot,
  insertRuntimeEvent,
  insertQuotaSnapshot,
} from "../../db/queries/telemetry.js";
import { upsertGenerationJob } from "../../db/queries/generation.js";
import { upsertJobRun } from "../../db/queries/jobs.js";
import {
  ensureSourceInstance,
  recordHeartbeat,
} from "../../db/queries/sources.js";
import type { Activity } from "../../types/activity.js";
import { resolvePrivacyPolicy } from "../privacy/policy.js";
import {
  redactActivityPayload,
  redactSessionPayload,
  redactJobRunPayload,
  redactInferencePayload,
} from "../privacy/redact.js";

// ─── Broadcast ──────────────────────────────────────────────────────────────

export const activityEvents = new EventEmitter();
// Unlimited: this is an internal broadcast bus, not a leak-prone per-request
// emitter. In production setupRoutes runs once; in tests, many ephemeral
// servers register a listener each in the same process.
activityEvents.setMaxListeners(0);

// ─── Zod schemas (mirror src/types/ingest.ts) ──────────────────────────────

const sessionPayloadSchema = z.object({
  externalId: z.string().min(1),
  cwd: z.string().optional(),
  gitBranch: z.string().optional(),
  title: z.string().optional(),
  clientVersion: z.string().optional(),
  modelProvider: z.string().optional(),
  startedAt: z.string().min(1),
  endedAt: z.string().optional(),
  clearEndedAt: z.boolean().optional(),
  turnCount: z.number().optional(),
  toolCallCount: z.number().optional(),
  failureCount: z.number().optional(),
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  cacheReadTokens: z.number().optional(),
  cacheWriteTokens: z.number().optional(),
  costUsd: z.number().optional(),
}) satisfies z.ZodType<SessionPayload>;

const activityPayloadSchema = z.object({
  sessionExternalId: z.string().min(1),
  externalId: z.string().min(1).optional(),
  updateOnDuplicate: z.literal(true).optional(),
  parentExternalId: z.string().optional(),
  timestamp: z.string().min(1),
  completedAt: z.string().optional(),
  durationMs: z.number().optional(),
  actorType: z.enum(["user", "agent", "subagent", "system"]),
  actorId: z.string().min(1),
  actorRole: z.string().optional(),
  actorSessionLabel: z.string().optional(),
  actionType: z.enum([
    "tool_call",
    "delegation",
    "api_call",
    "decision",
    "message",
    "event",
    "user_request",
    "agent_spawn",
    "session_start",
    "session_end",
  ]),
  toolName: z.string().optional(),
  description: z.string().min(1),
  details: z.unknown().optional(),
  status: z.string().min(1),
  result: z.unknown().optional(),
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  totalTokens: z.number().optional(),
  cacheReadTokens: z.number().optional(),
  cacheWriteTokens: z.number().optional(),
  model: z.string().optional(),
  costUsd: z.number().optional(),
  requestId: z.string().optional(),
  tags: z.string().optional(),
  metadata: z.unknown().optional(),
}) satisfies z.ZodType<ActivityPayload>;

const inferenceRequestPayloadSchema = z.object({
  externalId: z.string().optional(),
  timestamp: z.string().min(1),
  model: z.string().optional(),
  endpoint: z.string().optional(),
  clientLabel: z.string().optional(),
  workload: z.enum(["foreground", "background", "unknown"]).optional(),
  promptTokens: z.number().optional(),
  completionTokens: z.number().optional(),
  cachedTokens: z.number().optional(),
  ttftMs: z.number().optional(),
  durationMs: z.number().optional(),
  tokensPerSec: z.number().optional(),
  slotId: z.number().optional(),
  status: z.enum(["success", "cancelled", "context_overflow", "error"]),
  error: z.string().optional(),
  details: z.unknown().optional(),
}) satisfies z.ZodType<InferenceRequestPayload>;

const runtimeSnapshotPayloadSchema = z.object({
  timestamp: z.string().min(1),
  kind: z.enum(["slots", "health", "system", "models"]),
  slotsTotal: z.number().optional(),
  slotsBusy: z.number().optional(),
  modelsLoaded: z.unknown().optional(),
  healthy: z.boolean().optional(),
  payload: z.unknown().optional(),
}) satisfies z.ZodType<RuntimeSnapshotPayload>;

const runtimeEventPayloadSchema = z.object({
  timestamp: z.string().min(1),
  endedAt: z.string().optional(),
  kind: z.enum([
    "slots_saturated",
    "model_load",
    "model_unload",
    "service_down",
    "service_up",
    "context_overflow",
    "request_cancelled",
  ]),
  severity: z.enum(["info", "warning", "error"]).optional(),
  summary: z.string().min(1),
  details: z.unknown().optional(),
}) satisfies z.ZodType<RuntimeEventPayload>;

const quotaSnapshotPayloadSchema = z.object({
  timestamp: z.string().min(1),
  limitId: z.string().min(1),
  usedPercent: z.number(),
  windowMinutes: z.number().optional(),
  resetsAt: z.string().optional(),
}) satisfies z.ZodType<QuotaSnapshotPayload>;

const generationJobPayloadSchema = z.object({
  externalId: z.string().min(1),
  status: z.enum(["queued", "running", "success", "error", "interrupted"]),
  firstSeenAt: z.string().min(1),
  observedStartedAt: z.string().optional(),
  observedCompletedAt: z.string().optional(),
  workflowHash: z.string().optional(),
  nodeCount: z.number().optional(),
  outputCount: z.number().optional(),
  details: z.unknown().optional(),
}) satisfies z.ZodType<GenerationJobPayload>;

const jobRunPayloadSchema = z.object({
  jobId: z.string().min(1),
  jobName: z.string().optional(),
  jobKind: z.enum(["inferred", "collector", "scheduled"]).optional(),
  startedAt: z.string().min(1),
  endedAt: z.string().optional(),
  status: z.enum(["success", "failure", "cancelled", "timeout", "running"]),
  durationMs: z.number().optional(),
  output: z.string().optional(),
  error: z.string().optional(),
  details: z.unknown().optional(),
}) satisfies z.ZodType<JobRunPayload>;

const heartbeatSchema = z.object({
  sourceId: z.string().min(1),
  instanceId: z.string().min(1),
  status: z.enum(["ok", "off", "error"]),
  detail: z.string().optional(),
  eventsEmitted: z.number(),
}) satisfies z.ZodType<Heartbeat>;

const eventSchemasByKind: Record<string, z.ZodTypeAny> = {
  session: sessionPayloadSchema,
  activity: activityPayloadSchema,
  inference_request: inferenceRequestPayloadSchema,
  runtime_snapshot: runtimeSnapshotPayloadSchema,
  runtime_event: runtimeEventPayloadSchema,
  quota_snapshot: quotaSnapshotPayloadSchema,
  generation_job: generationJobPayloadSchema,
  job_run: jobRunPayloadSchema,
};

// ─── Batch processing ───────────────────────────────────────────────────────

export async function processIngestBatch(
  db: SqliteDatabase,
  batch: IngestBatch,
): Promise<IngestAck> {
  // Desktop collectors name instances per-machine, so the row may not exist
  // yet — register it before any event writes hit the instance_id FK. The
  // heartbeat that would create it only fires after the first tick's
  // sendBatched calls, so the batch path cannot rely on heartbeat ordering.
  // An unknown source id or malformed instance id registers nothing; reject
  // the batch up front rather than surfacing N opaque FK violations.
  if (!(await ensureSourceInstance(db, batch.sourceId, batch.instanceId))) {
    return {
      accepted: 0,
      duplicates: 0,
      rejected: batch.events.map((_, index) => ({
        index,
        error: `Unknown source or malformed instance id: ${batch.sourceId}/${batch.instanceId}`,
      })),
    };
  }

  let accepted = 0;
  let duplicates = 0;
  const rejected: IngestRejection[] = [];

  for (let index = 0; index < batch.events.length; index++) {
    const event = batch.events[index];
    try {
      const result = await processOneEvent(
        db,
        batch.sourceId,
        batch.instanceId,
        event,
      );
      if (result === "duplicate") duplicates++;
      else accepted++;
    } catch (err) {
      rejected.push({
        index,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { accepted, duplicates, rejected };
}

async function processOneEvent(
  db: SqliteDatabase,
  sourceId: string,
  instanceId: string,
  event: IngestEvent,
): Promise<"accepted" | "duplicate"> {
  const schema = eventSchemasByKind[event.kind];
  if (!schema) {
    throw new Error(`Unknown ingest event kind: ${event.kind}`);
  }

  const parsed = schema.safeParse(event.payload);
  if (!parsed.success) {
    throw new Error(`Invalid ${event.kind} payload: ${parsed.error.message}`);
  }

  const isDuplicate = await checkAndRecordDedupe(
    db,
    sourceId,
    instanceId,
    event.kind,
    event.naturalKey,
  );
  // Only an explicitly update-capable activity may reuse a natural key to
  // apply a newer observation (for example, Codex's cumulative token total
  // for one turn). Generic activity retries must remain fully idempotent.
  const activityPayload =
    event.kind === "activity" ? (parsed.data as ActivityPayload) : undefined;
  const canAttemptActivityReapply =
    isDuplicate &&
    activityPayload?.updateOnDuplicate === true &&
    typeof activityPayload.externalId === "string" &&
    activityPayload.externalId.length > 0;
  let canReapplyActivity = false;
  if (canAttemptActivityReapply) {
    const dedupeEntityId = await getDedupeEntityId(
      db,
      sourceId,
      instanceId,
      event.kind,
      event.naturalKey,
    );
    const sessionRowId = computeSessionId(
      sourceId,
      activityPayload.sessionExternalId,
    );
    const activity = dedupeEntityId
      ? await db.get<{ id: string }>(
          `SELECT id
           FROM activities
           WHERE id = ?
             AND source_id = ?
             AND instance_id = ?
             AND session_id = ?
             AND external_id = ?`,
          dedupeEntityId,
          sourceId,
          instanceId,
          sessionRowId,
          activityPayload.externalId,
        )
      : undefined;
    if (!activity) {
      throw new Error(
        `Duplicate activity ${event.naturalKey} does not match its original activity row`,
      );
    }
    canReapplyActivity = true;
  }
  if (isDuplicate && !canReapplyActivity) return "duplicate";

  const privacy = resolvePrivacyPolicy();

  try {
    switch (event.kind) {
      case "session": {
        const sessionPayload = redactSessionPayload(
          parsed.data as SessionPayload,
          privacy,
        );
        await upsertSession(db, sourceId, instanceId, sessionPayload);
        break;
      }
      case "activity": {
        const payload = redactActivityPayload(
          parsed.data as ActivityPayload,
          privacy,
        );
        const existingSessionId = computeSessionId(
          sourceId,
          payload.sessionExternalId,
        );
        await ensureSessionPlaceholder(
          db,
          sourceId,
          instanceId,
          payload.sessionExternalId,
          payload.timestamp,
        );
        const row = await insertActivity(
          db,
          sourceId,
          instanceId,
          existingSessionId,
          payload,
        );
        if (!isDuplicate) {
          await setDedupeEntityId(
            db,
            sourceId,
            instanceId,
            event.kind,
            event.naturalKey,
            row.id,
          );
        }
        // Counters come from upsertSession's MAX-merge across session-event
        // re-observations, not from here — see touchSessionActivity's doc comment.
        await touchSessionActivity(db, existingSessionId, payload.timestamp);
        const activity: Activity = rowToActivity(row);
        // Same event name for insert and lifecycle update — SSE clients
        // refresh list rows by id/externalId either way.
        activityEvents.emit("activity:created", activity);
        break;
      }
      case "inference_request": {
        await insertInferenceRequest(
          db,
          sourceId,
          instanceId,
          redactInferencePayload(
            parsed.data as InferenceRequestPayload,
            privacy,
          ),
        );
        break;
      }
      case "runtime_snapshot": {
        await insertRuntimeSnapshot(
          db,
          sourceId,
          instanceId,
          parsed.data as RuntimeSnapshotPayload,
        );
        break;
      }
      case "runtime_event": {
        await insertRuntimeEvent(
          db,
          sourceId,
          instanceId,
          parsed.data as RuntimeEventPayload,
        );
        break;
      }
      case "quota_snapshot": {
        await insertQuotaSnapshot(
          db,
          sourceId,
          instanceId,
          parsed.data as QuotaSnapshotPayload,
        );
        break;
      }
      case "generation_job": {
        await upsertGenerationJob(
          db,
          sourceId,
          instanceId,
          parsed.data as GenerationJobPayload,
        );
        break;
      }
      case "job_run": {
        await upsertJobRun(
          db,
          sourceId,
          redactJobRunPayload(parsed.data as JobRunPayload, privacy),
        );
        break;
      }
    }
  } catch (err) {
    // Do not leave a burned natural key when the write failed — otherwise a
    // later successful path (or retry after a bugfix) can never apply.
    if (!isDuplicate) {
      await releaseDedupe(
        db,
        sourceId,
        instanceId,
        event.kind,
        event.naturalKey,
      );
    }
    throw err;
  }

  return isDuplicate ? "duplicate" : "accepted";
}

export async function processHeartbeat(
  db: SqliteDatabase,
  raw: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = heartbeatSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.message };
  }
  const beat = parsed.data;
  // Auto-register per-machine desktop instances (e.g. `devin@strix-point`)
  // on first contact; unknown source ids and malformed instance ids are
  // still rejected.
  if (!(await ensureSourceInstance(db, beat.sourceId, beat.instanceId))) {
    return {
      ok: false,
      error: `Unknown source or malformed instance id: ${beat.sourceId}/${beat.instanceId}`,
    };
  }
  await recordHeartbeat(
    db,
    beat.sourceId,
    beat.instanceId,
    beat.status,
    // detail on off/ok beats is informational ("no sessions.db found"),
    // not a failure — only error beats may populate last_error.
    beat.status === "error" ? beat.detail : undefined,
  );
  return { ok: true };
}
