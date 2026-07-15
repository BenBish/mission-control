import type { Database as SqliteDatabase } from "sqlite";
import {
  listFailedActivities,
  rowToActivity,
  type ActivityRow,
} from "./activities.js";
import {
  listFailedInferenceRequests,
  listRecentRuntimeEvents,
} from "./telemetry.js";

export interface FailureItem {
  kind: "activity" | "inference_request" | "runtime_event";
  id: string;
  sourceId: string;
  timestamp: string;
  summary: string;
  detail?: string;
}

/**
 * Union of activity failures + inference failures + runtime_events.
 * P1 only has activities (Claude Code/Codex) actually populated — inference
 * and runtime tables stay empty until the Hermes collector lands in P2, so
 * this naturally degrades to activities-only for now rather than fabricating
 * placeholder rows.
 */
export async function listRecentFailures(
  db: SqliteDatabase,
  limit = 50,
): Promise<FailureItem[]> {
  const [activities, inferenceRequests, runtimeEvents] = await Promise.all([
    listFailedActivities(db, limit),
    listFailedInferenceRequests(db, limit),
    listRecentRuntimeEvents(db, limit),
  ]);

  const items: FailureItem[] = [
    ...activities.map((row: ActivityRow) => {
      const activity = rowToActivity(row);
      return {
        kind: "activity" as const,
        id: activity.id,
        sourceId: activity.sourceId,
        timestamp: activity.timestamp,
        summary: activity.description,
        detail: activity.result?.error,
      };
    }),
    ...inferenceRequests.map((row) => ({
      kind: "inference_request" as const,
      id: row.id,
      sourceId: row.source_id,
      timestamp: row.timestamp,
      summary: `${row.status} on ${row.model ?? "unknown model"} (${row.client_label ?? "unknown client"})`,
      detail: row.error ?? undefined,
    })),
    ...runtimeEvents
      .filter((row) => row.severity !== "info")
      .map((row) => ({
        kind: "runtime_event" as const,
        id: row.id,
        sourceId: row.source_id,
        timestamp: row.timestamp,
        summary: row.summary,
        detail: row.details ?? undefined,
      })),
  ];

  items.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  return items.slice(0, limit);
}
