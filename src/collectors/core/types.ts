/**
 * Collector/Scheduler contract — built on top of the wire contract in
 * src/types/ingest.ts (Sink, IngestBatch, Heartbeat, ...).
 */

import type { Sink } from "../../types/ingest.js";

export type SourceStatus = "ok" | "off" | "error";

export interface TickResult {
  eventsEmitted: number;
  sourceStatus: SourceStatus;
  detail?: string;
}

export interface Collector {
  sourceId: string;
  instanceId: string;
  /** How often the scheduler should call tick() for this collector */
  intervalMs: number;
  tick(sink: Sink): Promise<TickResult>;
}
