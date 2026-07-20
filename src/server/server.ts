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
import { Scheduler } from "../collectors/core/scheduler.js";
import { LocalSink } from "../collectors/core/sinks.js";
import { CollectorStateStore } from "../collectors/core/state-store.js";
import { buildHermesCollectors } from "../collectors/hermes/collector.js";
import { buildComfyUiCollectors } from "../collectors/comfyui/collector.js";
import { buildLemonadeCollectors } from "../collectors/lemonade/collector.js";
import { runRuntimeSnapshotRetention } from "../db/queries/retention.js";
import { syncAllProviders } from "../services/provider-connectors/index.js";

const RETENTION_INTERVAL_MS = 60 * 60_000; // hourly
/** Provider billing sync interval (default 1h). Override with MC_PROVIDER_SYNC_INTERVAL_MS. */
const DEFAULT_PROVIDER_SYNC_INTERVAL_MS = 60 * 60_000;

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
  host: string;
  databasePath: string;
  nodeEnv: string;
}

export class MissionControlServer {
  private app: Express;
  private db: Database;
  private config: ServerConfig;
  private authConfig: AuthConfig;
  private hermesScheduler: Scheduler | null = null;
  private comfyUiScheduler: Scheduler | null = null;
  private lemonadeScheduler: Scheduler | null = null;
  private retentionTimer: ReturnType<typeof setInterval> | null = null;
  private providerSyncTimer: ReturnType<typeof setInterval> | null = null;

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

    // One CollectorStateStore shared across every server-side poller
    // (Hermes, ComfyUI, Lemonade) — all three read/write the same
    // ~/.local/state/mission-control/cursors.json. Giving each its own
    // instance would mean each independently loads that file at
    // construction and persists its own in-memory copy back, silently
    // clobbering whichever poller's changes lost the race on the next
    // persist() — sharing one instance means concurrent persists just
    // re-serialize the same merged state, which is safe.
    const collectorState = new CollectorStateStore();

    // Hermes polling only makes sense colocated with llama-swap/
    // llama-server on the Strix Halo box — llama-server's individual
    // backend ports and its systemd journal aren't reachable from
    // anywhere else. Opt-in (not default-on) so running the server
    // elsewhere (local dev, tests, a future second deployment without
    // Hermes) doesn't spend 5s-interval cycles failing to reach
    // 127.0.0.1:8080/12345/12346/12347 and spawning journalctl for units
    // that don't exist there.
    if (process.env.MC_HERMES_POLLING_ENABLED === "true") {
      console.log("🔥 Hermes polling enabled");
      this.hermesScheduler = new Scheduler(
        buildHermesCollectors(collectorState),
        new LocalSink(this.db.raw()),
      );
      this.hermesScheduler.start();
    }

    // ComfyUI and Lemonade are independent services with independent
    // on/off state (one can be enabled without the other) — separate
    // flags, not folded into MC_HERMES_POLLING_ENABLED. Both currently
    // disabled by default in this deployment; both idle as a calm
    // sourceStatus:'off' (not error spam) when their target service isn't
    // running, same as every other poller here.
    if (process.env.MC_COMFYUI_POLLING_ENABLED === "true") {
      console.log("🎨 ComfyUI polling enabled");
      this.comfyUiScheduler = new Scheduler(
        buildComfyUiCollectors(collectorState),
        new LocalSink(this.db.raw()),
      );
      this.comfyUiScheduler.start();
    }
    if (process.env.MC_LEMONADE_POLLING_ENABLED === "true") {
      console.log(
        "🍋 Lemonade polling enabled (unverified — see src/collectors/lemonade/config.ts)",
      );
      this.lemonadeScheduler = new Scheduler(
        buildLemonadeCollectors(collectorState),
        new LocalSink(this.db.raw()),
      );
      this.lemonadeScheduler.start();
    }

    this.startRetentionJob();
    this.startProviderSyncJob();

    console.log("✓ Server initialized");
  }

  /**
   * runtime_snapshots is a 5s-interval poll (Hermes slots), the one table
   * in this schema with no natural event-driven bound on growth — left
   * alone it accumulates indefinitely for as long as polling runs. Runs
   * once at startup (covers any backlog from downtime) and then hourly.
   * Errors are logged, never fatal — a failed prune shouldn't take the
   * server down, it just tries again next hour.
   */
  private startRetentionJob(): void {
    const run = async () => {
      try {
        const result = await runRuntimeSnapshotRetention(this.db.raw());
        if (result.slotRowsRolledUp > 0 || result.otherRowsDeleted > 0) {
          console.log(
            `🧹 Retention: rolled up ${result.slotRowsRolledUp} slot snapshot(s) into ${result.rollupBucketsWritten} hourly bucket(s), pruned ${result.otherRowsDeleted} other snapshot(s)`,
          );
        }
      } catch (err) {
        console.error("Retention job failed:", err);
      }
    };
    void run();
    this.retentionTimer = setInterval(() => void run(), RETENTION_INTERVAL_MS);
  }

  /**
   * Poll provider usage/cost APIs on an interval. Disabled when
   * MC_PROVIDER_SYNC_ENABLED is not "true" so local dev/tests don't hammer
   * billing endpoints. Manual POST /api/providers/sync always works.
   */
  private startProviderSyncJob(): void {
    if (process.env.MC_PROVIDER_SYNC_ENABLED !== "true") {
      return;
    }
    const rawInterval = process.env.MC_PROVIDER_SYNC_INTERVAL_MS;
    const parsed = parseInt(
      rawInterval || String(DEFAULT_PROVIDER_SYNC_INTERVAL_MS),
      10,
    );
    const intervalMs =
      Number.isFinite(parsed) && parsed >= 60_000
        ? parsed
        : DEFAULT_PROVIDER_SYNC_INTERVAL_MS;
    if (intervalMs !== parsed) {
      const safeRaw =
        rawInterval == null
          ? "(unset)"
          : rawInterval.length > 32
            ? `${rawInterval.slice(0, 32)}…`
            : rawInterval;
      console.warn(
        `💳 Invalid MC_PROVIDER_SYNC_INTERVAL_MS=${JSON.stringify(safeRaw)}; using default ${DEFAULT_PROVIDER_SYNC_INTERVAL_MS}ms`,
      );
    }
    console.log(`💳 Provider usage sync enabled (interval ${intervalMs}ms)`);
    const run = async () => {
      try {
        const results = await syncAllProviders(this.db.raw());
        const summary = results
          .map((r) => `${r.provider}:${r.status}(${r.rowsUpserted})`)
          .join(", ");
        console.log(`💳 Provider sync: ${summary}`);
      } catch (err) {
        console.error("Provider sync job failed:", err);
      }
    };
    void run();
    this.providerSyncTimer = setInterval(() => void run(), intervalMs);
  }

  async start(): Promise<void> {
    await this.initialize();

    return new Promise((resolve) => {
      this.app.listen(this.config.port, this.config.host, () => {
        console.log(
          `✨ Mission Control Server running on http://${this.config.host}:${this.config.port}`,
        );
        console.log(
          `📡 API: http://${this.config.host}:${this.config.port}/api`,
        );
        resolve();
      });
    });
  }

  getDatabase(): Database {
    return this.db;
  }

  async stop(): Promise<void> {
    console.log("Shutting down...");
    if (this.hermesScheduler) {
      this.hermesScheduler.stop();
    }
    if (this.comfyUiScheduler) {
      this.comfyUiScheduler.stop();
    }
    if (this.lemonadeScheduler) {
      this.lemonadeScheduler.stop();
    }
    if (this.retentionTimer) {
      clearInterval(this.retentionTimer);
      this.retentionTimer = null;
    }
    if (this.providerSyncTimer) {
      clearInterval(this.providerSyncTimer);
      this.providerSyncTimer = null;
    }
    await this.db.close();
    console.log("✓ Stopped");
  }
}

async function main() {
  const config: ServerConfig = {
    port: parseInt(process.env.PORT || "3001"),
    // Loopback-only by default: this is meant to sit behind `tailscale
    // serve` (which proxies to 127.0.0.1) rather than be reachable
    // directly on the LAN/tailnet interface. It also sidesteps a real
    // conflict — binding 0.0.0.0 fails if tailscaled already holds a
    // specific address on the same port (as it does once `tailscale
    // serve` is configured), since a wildcard bind overlaps any existing
    // specific one. Override with HOST=0.0.0.0 if you really want it
    // reachable on all interfaces.
    host: process.env.HOST || "127.0.0.1",
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
