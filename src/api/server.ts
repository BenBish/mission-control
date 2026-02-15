/**
 * Express Server
 * Main API server for Mission Control Activity Feed
 */

import express, { Express } from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { Database } from '../db/database.js';
import { ActivityLogger } from '../logger/activity-logger.js';
import { setupRoutes } from './routes.js';

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

  constructor(config: ServerConfig) {
    this.config = config;
    this.app = express();
    this.db = new Database(config.databasePath);
    this.logger = new ActivityLogger(this.db);

    this.setupMiddleware();
  }

  /**
   * Setup Express middleware
   */
  private setupMiddleware(): void {
    this.app.use(cors());
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

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
    console.log('🚀 Initializing Activity Feed Server...');

    // Initialize database
    await this.db.initialize();
    console.log(`📦 Database initialized at ${this.config.databasePath}`);

    // Setup routes
    setupRoutes(this.app, this.logger);
    console.log('✓ Routes configured');

    // Make logger accessible to routes via app locals
    this.app.locals.logger = this.logger;
    this.app.locals.db = this.db;

    console.log('✓ Server initialized');
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    await this.initialize();

    return new Promise((resolve) => {
      this.app.listen(this.config.port, () => {
        console.log(`✨ Activity Feed Server running on http://localhost:${this.config.port}`);
        console.log(`📊 Dashboard: http://localhost:${this.config.port}/dashboard`);
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
    console.log('Shutting down...');
    await this.db.close();
    console.log('✓ Stopped');
  }
}

/**
 * Start server from command line
 */
async function main() {
  const config: ServerConfig = {
    port: parseInt(process.env.PORT || '3001'),
    databasePath: process.env.DATABASE_PATH || './data/mission-control.db',
    nodeEnv: process.env.NODE_ENV || 'development',
  };

  const server = new ActivityFeedServer(config);

  // Graceful shutdown
  process.on('SIGINT', async () => {
    await server.stop();
    process.exit(0);
  });

  await server.start();
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
