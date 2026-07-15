import type { Database as SqliteDatabase } from "sqlite";
import type {
  Heartbeat,
  IngestAck,
  IngestBatch,
  Sink,
} from "../../types/ingest.js";
import {
  processIngestBatch,
  processHeartbeat,
} from "../../server/services/ingest-service.js";

export interface HttpSinkConfig {
  /** e.g. 'http://strix-halo.tailnet-name.ts.net:3001' — no trailing slash */
  serverUrl: string;
  apiKey: string;
}

/**
 * Pushes batches/heartbeats to the server's ingest API over HTTP (Tailscale).
 * The only Sink the desktop collectors need — both Claude Code and Codex
 * are push-model sources. Server-side pollers (Hermes/Lemonade/ComfyUI, P2+)
 * get a LocalSink that calls the ingest service in-process instead.
 */
export class HttpSink implements Sink {
  constructor(private config: HttpSinkConfig) {}

  async send(batch: IngestBatch): Promise<IngestAck> {
    const res = await fetch(`${this.config.serverUrl}/api/ingest/batch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.config.apiKey,
      },
      body: JSON.stringify(batch),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `ingest batch failed: ${res.status} ${res.statusText} ${text}`,
      );
    }
    return (await res.json()) as IngestAck;
  }

  async heartbeat(beat: Heartbeat): Promise<void> {
    const res = await fetch(`${this.config.serverUrl}/api/ingest/heartbeat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.config.apiKey,
      },
      body: JSON.stringify(beat),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `heartbeat failed: ${res.status} ${res.statusText} ${text}`,
      );
    }
  }
}

/**
 * Calls the ingest service directly, in-process — no HTTP round-trip, no
 * separate server to run. For collectors that are colocated with the
 * server itself (Hermes today; Lemonade/ComfyUI in P3), where a self-HTTP
 * call would just add latency and a second thing to keep running for no
 * benefit — same validation/dedupe/upsert path as HttpSink, just invoked
 * as a function call instead of a fetch.
 */
export class LocalSink implements Sink {
  constructor(private db: SqliteDatabase) {}

  async send(batch: IngestBatch): Promise<IngestAck> {
    return processIngestBatch(this.db, batch);
  }

  async heartbeat(beat: Heartbeat): Promise<void> {
    const result = await processHeartbeat(this.db, beat);
    if (!result.ok) {
      throw new Error(`heartbeat failed: ${result.error}`);
    }
  }
}
