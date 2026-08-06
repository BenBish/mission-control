import type { Express, Request, Response } from "express";
import type { Database } from "../../db/database.js";
import type { AuthConfig } from "../auth.js";
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
import { registerProviderRoutes } from "./providers.js";
import { registerPrivacyRoutes } from "./privacy.js";
import {
  resolvePrivacyPolicy,
  checkProductionAuthPolicy,
} from "../privacy/policy.js";

export function setupRoutes(
  app: Express,
  db: Database,
  authConfig?: AuthConfig,
): void {
  // Fallback when tests call setupRoutes without auth (treat as disabled)
  const auth: AuthConfig =
    authConfig ??
    ({
      enabled: false,
      username: "admin",
      passwordHash: "",
      viewerUsername: undefined,
      viewerPasswordHash: undefined,
      jwtSecret: new TextEncoder().encode("test"),
      apiKey: undefined,
      sessionTtl: 86400,
      secureCookie: false,
    } satisfies AuthConfig);

  app.get("/api/health", (_req: Request, res: Response) => {
    const policy = resolvePrivacyPolicy();
    const authCheck = checkProductionAuthPolicy(policy, auth.enabled);
    res.json({
      success: true,
      status: "healthy",
      timestamp: new Date().toISOString(),
      // Security posture without secrets — operators can scrape health.
      security: {
        authEnabled: auth.enabled,
        redactionMode: policy.redactionMode,
        unsafeUnauthenticated: policy.isProduction && !auth.enabled,
        warning:
          authCheck.ok && authCheck.warning ? authCheck.warning : undefined,
      },
    });
  });

  registerIngestRoutes(app, db);
  registerSourceRoutes(app, db);
  registerSessionRoutes(app, db, auth);
  registerActivityRoutes(app, db, auth);
  registerConsumptionRoutes(app, db);
  registerFailureRoutes(app, db);
  registerJobRoutes(app, db);
  registerRuntimeRoutes(app, db);
  registerContentionRoutes(app, db);
  registerGenerationRoutes(app, db);
  registerProviderRoutes(app, db, auth);
  registerPrivacyRoutes(app, db, auth);
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
