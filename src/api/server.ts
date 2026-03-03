/**
 * Express Server
 * Main API server for Mission Control Activity Feed
 */

import express, { Express } from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { Database } from "../db/database.js";
import { ActivityLogger } from "../logger/activity-logger.js";
import { setupRoutes } from "./routes.js";
import {
  resolveAuthConfig,
  authMiddleware,
  setupAuthRoutes,
  type AuthConfig,
} from "./auth.js";
import { profileContextMiddleware } from "./middleware/profile-context.js";
import { SessionLogScanner } from "../services/session-log-scanner.js";
import { CostLinker } from "../services/cost-linker.js";
import { initializePricing } from "../types/pricing.js";

// Load environment variables from .env file
// override: true ensures dotenv wins over Bun's built-in .env loader,
// which incorrectly expands $ in values like argon2 hashes.
dotenv.config({ override: true });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ServerConfig {
  port: number;
  databasePath: string;
  nodeEnv: string;
}

export class ActivityFeedServer {
  private app: Express;
  private db: Database;
  private logger: ActivityLogger;
  private config: ServerConfig;
  private authConfig: AuthConfig;
  private scanner: SessionLogScanner | null = null;
  private costLinker: CostLinker | null = null;

  constructor(config: ServerConfig) {
    this.config = config;
    this.app = express();
    this.db = new Database(config.databasePath);
    this.logger = new ActivityLogger(this.db, { profileId: "team" });

    // Resolve auth config (throws if misconfigured — fail early)
    this.authConfig = resolveAuthConfig();

    this.setupMiddleware();
  }

  /**
   * Setup Express middleware
   */
  private setupMiddleware(): void {
    this.app.use(cors());
    this.app.use(express.json({ limit: "5mb" }));
    this.app.use(express.urlencoded({ extended: true, limit: "5mb" }));

    // Serve static frontend files (Vite build output)
    const publicPath = "./dist-vite";
    this.app.use(express.static(publicPath));

    // Request logging
    this.app.use((req, res, next) => {
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
      next();
    });
  }

  /**
   * Initialize server (setup database and routes)
   */
  async initialize(): Promise<void> {
    console.log("🚀 Initializing Activity Feed Server...");

    // Initialize database
    await this.db.initialize();
    console.log(`📦 Database initialized at ${this.config.databasePath}`);

    // Setup authentication
    if (this.authConfig.enabled) {
      console.log("🔒 Authentication enabled");
    } else {
      console.log("🔓 Authentication disabled (MC_AUTH_ENABLED != true)");
    }

    // Auth activity logger helper
    const logAuthActivity = async (
      event: string,
      details: Record<string, unknown>,
    ) => {
      await this.db.createActivity({
        profileId: "team",
        sessionId: "auth",
        actor: { type: "system", id: "auth" },
        actionType: "event",
        description: event,
        details,
        status:
          event.includes("failed") || event.includes("rate_limited")
            ? "failure"
            : "success",
      });
    };

    // Auth routes (login/logout/me) — must be before auth middleware
    setupAuthRoutes(this.app, this.authConfig, logAuthActivity);

    // Auth middleware — protects API routes
    this.app.use(authMiddleware(this.authConfig));

    // Profile context middleware — extracts ?profile= from every request
    this.app.use(profileContextMiddleware);

    // Setup routes
    setupRoutes(this.app, this.logger);
    console.log("✓ Routes configured");

    // Make logger accessible to routes via app locals
    this.app.locals.logger = this.logger;
    this.app.locals.db = this.db;

    // Setup real-time event broadcasting
    this.logger.on("activity:created", (activity) => {
      if (this.app.locals.broadcastActivity) {
        this.app.locals.broadcastActivity(activity);
      }
    });

    this.logger.on("activity:updated", (activity) => {
      if (this.app.locals.broadcastActivity) {
        this.app.locals.broadcastActivity(activity);
      }
    });

    console.log("✓ Real-time event broadcasting enabled");

    // Initialize pricing (OpenRouter API with static fallback)
    await initializePricing();
    console.log("✓ Pricing service initialized");

    // Start session log scanner and cost linker
    this.costLinker = new CostLinker(this.db);
    this.scanner = new SessionLogScanner(this.db, { profileId: "team" });

    // After each scan, run the cost linker
    const originalScan = this.scanner.scan.bind(this.scanner);
    this.scanner.scan = async () => {
      const result = await originalScan();
      if (result.newGenerations > 0 && this.costLinker) {
        await this.costLinker.link();
      }
      return result;
    };

    this.scanner.start();
    console.log("✓ Session log scanner started");

    // Expose scanner and linker for route handlers
    this.app.locals.scanner = this.scanner;
    this.app.locals.costLinker = this.costLinker;

    console.log("✓ Server initialized");
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    await this.initialize();

    return new Promise((resolve) => {
      this.app.listen(this.config.port, () => {
        console.log(
          `✨ Activity Feed Server running on http://localhost:${this.config.port}`,
        );
        console.log(
          `📊 Dashboard: http://localhost:${this.config.port}/dashboard`,
        );
        console.log(`📡 API: http://localhost:${this.config.port}/api`);
        resolve();
      });
    });
  }

  /**
   * Get the logger instance
   */
  getLogger(): ActivityLogger {
    return this.logger;
  }

  /**
   * Get the database instance
   */
  getDatabase(): Database {
    return this.db;
  }

  /**
   * Stop the server gracefully
   */
  async stop(): Promise<void> {
    console.log("Shutting down...");
    if (this.scanner) {
      this.scanner.stop();
    }
    await this.db.close();
    console.log("✓ Stopped");
  }
}

/**
 * Start server from command line
 */
async function main() {
  const config: ServerConfig = {
    port: parseInt(process.env.PORT || "3001"),
    databasePath: process.env.DATABASE_PATH || "./data/mission-control.db",
    nodeEnv: process.env.NODE_ENV || "development",
  };

  const server = new ActivityFeedServer(config);

  // Graceful shutdown
  process.on("SIGINT", async () => {
    await server.stop();
    process.exit(0);
  });

  await server.start();
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
