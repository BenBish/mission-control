import type { Express, Request, Response } from "express";
import type { Database } from "../../db/database.js";
import type { IngestBatch } from "../../types/ingest.js";
import {
  processIngestBatch,
  processHeartbeat,
} from "../services/ingest-service.js";

export function registerIngestRoutes(app: Express, db: Database): void {
  app.post("/api/ingest/batch", async (req: Request, res: Response) => {
    const batch = req.body as IngestBatch;
    if (!batch || !Array.isArray(batch.events)) {
      return res
        .status(400)
        .json({ success: false, error: "Invalid batch: missing events[]" });
    }
    try {
      const ack = await processIngestBatch(db.raw(), batch);
      return res.json({ success: true, ...ack });
    } catch (err) {
      console.error("[ingest] batch processing failed:", err);
      return res
        .status(500)
        .json({ success: false, error: "Internal error processing batch" });
    }
  });

  app.post("/api/ingest/heartbeat", async (req: Request, res: Response) => {
    const result = await processHeartbeat(db.raw(), req.body);
    if (!result.ok) {
      return res.status(400).json({ success: false, error: result.error });
    }
    return res.json({ success: true });
  });

  // Cursor recovery is a P2+ concern — collectors keep their own local
  // cursor state (~/.local/state/mission-control/cursors.json) for now.
  app.get("/api/ingest/cursors", (_req: Request, res: Response) => {
    res.status(501).json({ success: false, error: "Not implemented yet (P2)" });
  });
}
