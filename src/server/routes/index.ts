import type { Express, Request, Response } from "express";
import type { Database } from "../../db/database.js";
import { registerIngestRoutes } from "./ingest.js";
import { registerSourceRoutes } from "./sources.js";
import { registerSessionRoutes } from "./sessions.js";
import { registerActivityRoutes } from "./activities.js";
import { registerConsumptionRoutes } from "./consumption.js";
import { registerFailureRoutes } from "./failures.js";
import { registerJobRoutes } from "./jobs.js";
import { registerStreamRoutes } from "./stream.js";
import { registerRuntimeRoutes } from "./runtime.js";
import { registerContentionRoutes } from "./contention.js";
import { registerGenerationRoutes } from "./generations.js";

export function setupRoutes(app: Express, db: Database): void {
  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({
      success: true,
      status: "healthy",
      timestamp: new Date().toISOString(),
    });
  });

  registerIngestRoutes(app, db);
  registerSourceRoutes(app, db);
  registerSessionRoutes(app, db);
  registerActivityRoutes(app, db);
  registerConsumptionRoutes(app, db);
  registerFailureRoutes(app, db);
  registerJobRoutes(app, db);
  registerRuntimeRoutes(app, db);
  registerContentionRoutes(app, db);
  registerGenerationRoutes(app, db);
  registerStreamRoutes(app);

  // SPA fallback — must be last.
  app.get("*", (req: Request, res: Response) => {
    if (!req.path.startsWith("/api")) {
      res.sendFile("dist-vite/index.html", { root: "." }, (err) => {
        if (err) {
          res.status(404).json({ success: false, error: "Not found" });
        }
      });
    } else {
      res.status(404).json({ success: false, error: "API endpoint not found" });
    }
  });
}
