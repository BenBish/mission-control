import type {
  Heartbeat,
  IngestAck,
  IngestBatch,
  Sink,
} from "../../types/ingest.js";

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
