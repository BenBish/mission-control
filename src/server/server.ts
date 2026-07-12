/**
 * Express Server
 * Main API server for Mission Control
 */

import express, { Express } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { Database } from "../db/database.js";
import { setupRoutes } from "./routes/index.js";
import {
  resolveAuthConfig,
  authMiddleware,
  setupAuthRoutes,
  type AuthConfig,
} from "./auth.js";

// Preserve command-line env vars before dotenv loads
// (Playwright passes PORT=3051, etc as command-line arguments)
const cliEnvVars = { ...process.env };

// Load environment variables from .env file
// override: true ensures dotenv wins over Bun's .env loader, but we restore
// CLI vars afterward to maintain precedence.
dotenv.config({ override: true });

// Restore command-line env vars (they take precedence over .env)
Object.assign(process.env, cliEnvVars);

interface ServerConfig {
  port: number;
  databasePath: string;
  nodeEnv: string;
}

export class MissionControlServer {
  private app: Express;
  private db: Database;
  private config: ServerConfig;
  private authConfig: AuthConfig;

  constructor(config: ServerConfig) {
    this.config = config;
    this.app = express();
    this.db = new Database(config.databasePath);

    // Resolve auth config (throws if misconfigured — fail early)
    this.authConfig = resolveAuthConfig();

    this.setupMiddleware();
  }

  private setupMiddleware(): void {
    const corsOrigins = process.env.MC_CORS_ORIGINS
      ? process.env.MC_CORS_ORIGINS.split(",").map((s) => s.trim())
      : ["http://localhost:3000", "http://localhost:3050"];

    this.app.use(
      cors({
        origin: corsOrigins,
        credentials: true,
      }),
    );
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
    console.log("🚀 Initializing Mission Control Server...");

    await this.db.initialize();
    console.log(`📦 Database initialized at ${this.config.databasePath}`);

    if (this.authConfig.enabled) {
      console.log("🔒 Authentication enabled");
    } else {
      console.log("🔓 Authentication disabled (MC_AUTH_ENABLED != true)");
    }

    // Auth routes (login/logout/me) — must be before auth middleware
    setupAuthRoutes(this.app, this.authConfig);

    // Auth middleware — protects API routes
    this.app.use(authMiddleware(this.authConfig));

    setupRoutes(this.app, this.db);
    console.log("✓ Routes configured");

    console.log("✓ Server initialized");
  }

  async start(): Promise<void> {
    await this.initialize();

    return new Promise((resolve) => {
      this.app.listen(this.config.port, () => {
        console.log(
          `✨ Mission Control Server running on http://localhost:${this.config.port}`,
        );
        console.log(`📡 API: http://localhost:${this.config.port}/api`);
        resolve();
      });
    });
  }

  getDatabase(): Database {
    return this.db;
  }

  async stop(): Promise<void> {
    console.log("Shutting down...");
    await this.db.close();
    console.log("✓ Stopped");
  }
}

async function main() {
  const config: ServerConfig = {
    port: parseInt(process.env.PORT || "3001"),
    databasePath: process.env.DATABASE_PATH || "./data/mission-control.db",
    nodeEnv: process.env.NODE_ENV || "development",
  };

  const server = new MissionControlServer(config);

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
