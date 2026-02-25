/**
 * API Routes
 * Express routes for activity feed endpoints
 */

import { Express, Request, Response } from "express";
import { ActivityLogger } from "../logger/activity-logger.js";
import {
  ActivityFilter,
  Activity,
  TokenInfo,
  CostInfo,
} from "../types/activity.js";
import { calculateCost, getPricingStatus } from "../types/pricing.js";
import type { SessionLogScanner } from "../services/session-log-scanner.js";
import type { CostLinker } from "../services/cost-linker.js";
import type { Agent, AgentDetail } from "../types/agent.js";
import { agentService } from "./services/agent-service.js";
import { CronService } from "../services/cron-service.js";
import { AgentService } from "../services/agent-service.js";
import { SkillsService } from "../services/skills-service.js";
import { toActorId } from "../lib/agent-utils.js";

// Store active SSE clients
const sseClients: Set<Response> = new Set();

// Default limits for activity queries
const DEFAULT_ACTIVITY_LIMIT = 100;
const MAX_ACTIVITY_LIMIT = 100000;

// ============================================================================
// AGENT DISPLAY NAME MAPPING (centralised single source of truth)
// ============================================================================

/** Known agent ID → display name + emoji */
const AGENT_DISPLAY_NAMES: Record<
  string,
  { displayName: string; emoji: string }
> = {
  main: { displayName: "Orchestrator", emoji: "🎯" },
  engineer: { displayName: "Engineer", emoji: "🔧" },
  "engineer-2": { displayName: "Engineer 2", emoji: "🔧" },
  "solutions-architect": { displayName: "Solutions Architect", emoji: "🏗️" },
  "code-reviewer": { displayName: "Code Reviewer", emoji: "🔍" },
  "manual-tester": { displayName: "Manual Tester", emoji: "🧪" },
  "project-manager": { displayName: "Project Manager", emoji: "📋" },
};

/**
 * Resolve an actor ID to a human-readable display name and emoji.
 * - Known agents get their mapped name
 * - "unknown" gets a generic label
 * - Unmapped IDs are title-cased with a generic robot emoji
 */
export function resolveActorDisplayName(actorId: string): {
  displayName: string;
  emoji: string;
} {
  const known = AGENT_DISPLAY_NAMES[actorId];
  if (known) return known;

  if (actorId === "unknown") {
    return { displayName: "Unknown Agent", emoji: "❓" };
  }

  // Fallback: title-case the ID (replace hyphens/underscores with spaces)
  const titleCased = actorId
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return { displayName: titleCased, emoji: "🤖" };
}

/**
 * Enrich an activity's actor with displayName and emoji fields.
 * Mutates the activity in-place for efficiency.
 * Safely handles activities without an actor field.
 */
function enrichActivityActor(activity: any): any {
  if (!activity?.actor?.id) return activity;
  const { displayName, emoji } = resolveActorDisplayName(activity.actor.id);
  activity.actor.displayName = displayName;
  activity.actor.emoji = emoji;
  return activity;
}

export function setupRoutes(app: Express, logger: ActivityLogger) {
  // ============================================================================
  // HELPER FUNCTIONS
  // ============================================================================

  /**
   * Compute agent status based on last activity time and action count
   * Used consistently across both /api/agents and /api/agents/:id endpoints
   */
  function computeAgentStatus(
    lastActiveDate: Date,
    actionCount: number,
  ): Agent["status"] {
    const now = new Date();
    const diffMs = now.getTime() - lastActiveDate.getTime();
    const diffMins = diffMs / 60000;

    if (diffMins < 5) return "online";
    if (diffMins < 30) return "idle";
    if (actionCount > 0) return "busy";
    return "offline";
  }

  // ============================================================================
  // ACTIVITY ENDPOINTS
  // ============================================================================

  /**
   * GET /api/activities
   * Get activities with optional filtering
   */
  app.get("/api/activities", async (req: Request, res: Response) => {
    try {
      const filter: ActivityFilter = {
        sessionId: req.query.sessionId as string | undefined,
        actorId: req.query.actorId as string | undefined,
        actorType: req.query.actorType as any,
        actionType: req.query.actionType as any,
        toolName: req.query.toolName as string | undefined,
        status: req.query.status as any,
        startTime: req.query.startTime as string | undefined,
        endTime: req.query.endTime as string | undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string) : 100,
        offset: req.query.offset ? parseInt(req.query.offset as string) : 0,
      };

      const activities = (await logger.getActivity("")) || [];

      // Fetch activities from database
      const db = logger.getDatabase();
      const results = await db.getActivities(filter);

      // Enrich actor display names
      for (const activity of results) {
        enrichActivityActor(activity);
      }

      res.json({
        success: true,
        count: results.length,
        activities: results,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * POST /api/activities
   * Create new activities (received from OpenClaw plugins)
   */
  app.post("/api/activities", async (req: Request, res: Response) => {
    try {
      const { activities } = req.body;
      if (!activities || !Array.isArray(activities)) {
        return res.status(400).json({
          success: false,
          error: "Invalid request: expected { activities: [...] }",
        });
      }

      const db = logger.getDatabase();
      const created = [];

      for (const activity of activities) {
        // Map plugin activity type to database actionType
        const actionTypeMap: Record<string, string> = {
          tool_execution: "tool_call",
          message_received: "message",
          message_sent: "message",
          agent_run: "decision",
          session_start: "session_start",
          session_end: "session_end",
          model_usage: "api_call",
          session_state: "event",
          queue_event: "event",
        };

        // Map plugin activity type to actor type
        const actorTypeMap: Record<string, string> = {
          session_start: "orchestrator",
          session_end: "orchestrator",
          agent_run: "subagent",
        };

        // Determine the correct actor type based on activity type
        let actorType = actorTypeMap[activity.type] || "subagent";
        if (activity.type.startsWith("session")) {
          actorType = "orchestrator";
        }

        // Extract model and tokens from activity
        const model = activity.model || activity.details?.model;
        const tokens: TokenInfo | undefined = activity.tokens
          ? {
              inputTokens: activity.tokens.input || 0,
              outputTokens: activity.tokens.output || 0,
              totalTokens:
                activity.tokens.total ||
                (activity.tokens.input || 0) + (activity.tokens.output || 0),
              model,
            }
          : undefined;

        // Calculate cost if tokens provided
        let cost: CostInfo | undefined;
        if (activity.costUsd !== undefined) {
          cost = { usd: activity.costUsd };
        } else if (tokens && model) {
          const calculatedCost = calculateCost(
            model,
            tokens.inputTokens,
            tokens.outputTokens,
          );
          if (calculatedCost > 0) {
            cost = { usd: calculatedCost };
          }
        }

        // Transform incoming activity to CreateActivityInput format
        const dbActivity = {
          sessionId:
            activity.sessionId || activity.sessionKey || "unknown-session",
          timestamp: activity.timestamp || new Date().toISOString(),
          actor: {
            id: activity.agentId || activity.actor?.id || "unknown",
            type: actorType as "orchestrator" | "subagent" | "user" | "system",
          },
          actionType: (actionTypeMap[activity.type] || "event") as
            | "tool_call"
            | "delegation"
            | "api_call"
            | "decision"
            | "message"
            | "event"
            | "user_request"
            | "agent_spawn"
            | "session_start"
            | "session_end",
          toolName: activity.toolName,
          description: `${activity.type} - ${activity.toolName || activity.sessionId || activity.sessionKey || "N/A"}`,
          details: activity,
          status: activity.error
            ? "failure"
            : activity.success === false
              ? "failure"
              : "success",
        };

        const createdActivity = await db.createActivity(dbActivity);

        // Update with tokens and cost if available
        if (tokens || cost) {
          await db.updateActivity(createdActivity.id, {
            tokens,
            cost,
          });
          // Update the created activity object for response
          if (tokens) createdActivity.tokens = tokens;
          if (cost) createdActivity.cost = cost;
        }

        // Enrich actor display names
        enrichActivityActor(createdActivity);
        created.push(createdActivity);

        // Broadcast to SSE clients
        if (app.locals.broadcastActivity) {
          const broadcastPayload = {
            ...dbActivity,
            id: createdActivity.id,
            tokens,
            cost,
          } as Activity;
          enrichActivityActor(broadcastPayload);
          app.locals.broadcastActivity(broadcastPayload);
        }
      }

      res.json({
        success: true,
        count: created.length,
        activities: created,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * POST /api/activities/backfill
   * Calculate costs for existing activities with tokens but no cost
   */
  app.post("/api/activities/backfill", async (req: Request, res: Response) => {
    try {
      const db = logger.getDatabase();

      // Get all activities with tokens but no cost
      const activities = await db.getActivities({ limit: MAX_ACTIVITY_LIMIT });
      const activitiesToUpdate = activities.filter(
        (a: Activity) =>
          a.tokens && a.tokens.totalTokens > 0 && (!a.cost || a.cost.usd === 0),
      );

      let updatedCount = 0;
      let totalCostAdded = 0;

      for (const activity of activitiesToUpdate) {
        if (!activity.tokens) continue;

        const model =
          activity.tokens.model || activity.metadata?.model || "default";
        const calculatedCost = calculateCost(
          model,
          activity.tokens.inputTokens,
          activity.tokens.outputTokens,
        );

        if (calculatedCost > 0) {
          await db.updateActivity(activity.id, {
            cost: { usd: calculatedCost },
            tokens: {
              ...activity.tokens,
              model,
            },
          });
          updatedCount++;
          totalCostAdded += calculatedCost;
        }
      }

      res.json({
        success: true,
        updated: updatedCount,
        totalCostAdded,
        message: `Updated ${updatedCount} activities with calculated costs`,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/activities/:id
   * Get a specific activity by ID
   */
  app.get("/api/activities/:id", async (req: Request, res: Response) => {
    try {
      const activity = await logger.getActivity(req.params.id);
      if (!activity) {
        return res.status(404).json({
          success: false,
          error: "Activity not found",
        });
      }

      // Enrich actor display name
      enrichActivityActor(activity);

      res.json({
        success: true,
        activity,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/activities/search?q=query
   * Search activities by description or details
   */
  app.get("/api/activities/search", async (req: Request, res: Response) => {
    try {
      const query = req.query.q as string;
      if (!query) {
        return res.status(400).json({
          success: false,
          error: "Query parameter required",
        });
      }

      // Get all activities and filter (simple implementation)
      const db = logger.getDatabase();
      const activities = await db.getActivities({ limit: 1000 });
      const filtered = activities.filter(
        (a: Activity) =>
          a.description.toLowerCase().includes(query.toLowerCase()) ||
          a.toolName?.toLowerCase().includes(query.toLowerCase()) ||
          JSON.stringify(a.details).toLowerCase().includes(query.toLowerCase()),
      );

      // Enrich actor display names
      for (const activity of filtered) {
        enrichActivityActor(activity);
      }

      res.json({
        success: true,
        count: filtered.length,
        activities: filtered,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // ============================================================================
  // SESSION ENDPOINTS
  // ============================================================================

  /**
   * GET /api/sessions/:id
   * Get session summary and statistics
   */
  app.get("/api/sessions/:id", async (req: Request, res: Response) => {
    try {
      const summary = await logger.getSessionSummary(req.params.id);
      if (!summary) {
        return res.status(404).json({
          success: false,
          error: "Session not found",
        });
      }

      res.json({
        success: true,
        summary,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/sessions/:id/activities
   * Get all activities for a session
   */
  app.get(
    "/api/sessions/:id/activities",
    async (req: Request, res: Response) => {
      try {
        const activities = await logger.getSessionActivities(req.params.id);

        // Enrich actor display names
        for (const activity of activities) {
          enrichActivityActor(activity);
        }

        res.json({
          success: true,
          count: activities.length,
          activities,
        });
      } catch (error: any) {
        res.status(500).json({
          success: false,
          error: error.message,
        });
      }
    },
  );

  /**
   * GET /api/sessions/:id/cost-report
   * Get cost breakdown for a session
   */
  app.get(
    "/api/sessions/:id/cost-report",
    async (req: Request, res: Response) => {
      try {
        const summary = await logger.getSessionSummary(req.params.id);
        if (!summary) {
          return res.status(404).json({
            success: false,
            error: "Session not found",
          });
        }

        res.json({
          success: true,
          sessionId: req.params.id,
          totalCost: summary.stats.totalCost,
          totalTokens: summary.stats.totalTokens,
          actors: summary.actors,
          topTools: summary.topTools,
        });
      } catch (error: any) {
        res.status(500).json({
          success: false,
          error: error.message,
        });
      }
    },
  );

  // ============================================================================
  // AGGREGATION & REPORTING ENDPOINTS
  // ============================================================================

  /**
   * GET /api/cost-report
   * Get overall cost aggregation across all sessions
   */
  app.get("/api/cost-report", async (req: Request, res: Response) => {
    try {
      const db = logger.getDatabase();
      const activities = await db.getActivities({ limit: MAX_ACTIVITY_LIMIT });

      let totalCost = 0;
      let totalTokens = 0;
      const actorCosts: Record<
        string,
        { cost: number; tokens: number; actions: number }
      > = {};
      const toolCosts: Record<string, { cost: number; count: number }> = {};

      for (const activity of activities) {
        totalCost += activity.cost?.usd || 0;
        totalTokens += activity.tokens?.totalTokens || 0;

        // Actor breakdown
        const actorId = activity.actor.id;
        if (!actorCosts[actorId]) {
          actorCosts[actorId] = { cost: 0, tokens: 0, actions: 0 };
        }
        actorCosts[actorId].cost += activity.cost?.usd || 0;
        actorCosts[actorId].tokens += activity.tokens?.totalTokens || 0;
        actorCosts[actorId].actions++;

        // Tool breakdown
        if (activity.toolName) {
          if (!toolCosts[activity.toolName]) {
            toolCosts[activity.toolName] = { cost: 0, count: 0 };
          }
          toolCosts[activity.toolName].cost += activity.cost?.usd || 0;
          toolCosts[activity.toolName].count++;
        }
      }

      // Include LLM generation data if available
      let generationSummary = null;
      try {
        generationSummary = await db.getGenerationSummary();
      } catch {
        // Generation tables may not exist yet
      }

      res.json({
        success: true,
        totalCost: generationSummary ? generationSummary.totalCost : totalCost,
        totalTokens: generationSummary
          ? generationSummary.totalInputTokens +
            generationSummary.totalOutputTokens
          : totalTokens,
        activityCount: activities.length,
        actorCosts,
        toolCosts,
        generationSummary,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/stats
   * Get overall system statistics
   */
  app.get("/api/stats", async (req: Request, res: Response) => {
    try {
      const db = logger.getDatabase();
      const stats = await db.getStats();
      const MAX_ACTIVITY_LIMIT = 50000;
      const activities = await db.getActivities({
        limit: MAX_ACTIVITY_LIMIT,
      });

      const success = activities.filter(
        (a: Activity) => a.status === "success",
      ).length;
      const failure = activities.filter(
        (a: Activity) => a.status === "failure",
      ).length;

      // Use llm_generations as the authoritative cost source (matches /api/cost-report)
      // Fallback to activity-based sum when generation data is unavailable
      let totalCost: number;
      let totalTokens: number;
      let generationSummary = null;
      try {
        generationSummary = await db.getGenerationSummary();
      } catch {
        // Generation tables may not exist yet
      }

      if (generationSummary && generationSummary.totalGenerations > 0) {
        totalCost = generationSummary.totalCost;
        totalTokens =
          generationSummary.totalInputTokens +
          generationSummary.totalOutputTokens;
      } else {
        totalCost = activities.reduce(
          (sum: number, a: Activity) => sum + (a.cost?.usd || 0),
          0,
        );
        totalTokens = activities.reduce(
          (sum: number, a: Activity) => sum + (a.tokens?.totalTokens || 0),
          0,
        );
      }

      res.json({
        success: true,
        stats: {
          ...stats,
          successCount: success,
          failureCount: failure,
          successRate:
            activities.length > 0 ? (success / activities.length) * 100 : 0,
          totalCost,
          totalTokens,
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // ============================================================================
  // COST / LLM GENERATION ENDPOINTS
  // ============================================================================

  /**
   * POST /api/cost/scan
   * Trigger an immediate incremental scan of session logs
   */
  app.post("/api/cost/scan", async (req: Request, res: Response) => {
    try {
      const scanner = app.locals.scanner as SessionLogScanner | undefined;
      if (!scanner) {
        return res
          .status(503)
          .json({ success: false, error: "Scanner not initialized" });
      }

      const result = await scanner.scan();
      // Also run linker after scan
      const costLinker = app.locals.costLinker as CostLinker | undefined;
      if (costLinker && result.newGenerations > 0) {
        await costLinker.link();
      }

      res.json({ success: true, ...result });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * POST /api/cost/backfill
   * Full historical scan + link — resets scan state and re-reads all JSONL files
   */
  app.post("/api/cost/backfill", async (req: Request, res: Response) => {
    try {
      const scanner = app.locals.scanner as SessionLogScanner | undefined;
      const costLinker = app.locals.costLinker as CostLinker | undefined;
      if (!scanner) {
        return res
          .status(503)
          .json({ success: false, error: "Scanner not initialized" });
      }

      const scanResult = await scanner.fullScan();
      let linkResult = null;
      if (costLinker) {
        linkResult = await costLinker.link();
      }

      res.json({
        success: true,
        scan: scanResult,
        link: linkResult,
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * GET /api/cost/generations
   * List LLM generations with optional filters
   */
  app.get("/api/cost/generations", async (req: Request, res: Response) => {
    try {
      const db = logger.getDatabase();
      const generations = await db.getGenerations({
        agentId: req.query.agentId as string | undefined,
        model: req.query.model as string | undefined,
        startTime: req.query.startTime as string | undefined,
        endTime: req.query.endTime as string | undefined,
        unlinkedOnly: req.query.unlinkedOnly === "true",
        limit: req.query.limit ? parseInt(req.query.limit as string) : 100,
        offset: req.query.offset ? parseInt(req.query.offset as string) : 0,
      });

      res.json({
        success: true,
        count: generations.length,
        generations,
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * GET /api/cost/summary
   * Aggregated cost by agent, model, and totals
   */
  app.get("/api/cost/summary", async (req: Request, res: Response) => {
    try {
      const db = logger.getDatabase();
      const summary = await db.getGenerationSummary({
        startTime: req.query.startTime as string | undefined,
        endTime: req.query.endTime as string | undefined,
      });

      res.json({ success: true, ...summary });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * GET /api/cost/status
   * Scanner health: last scan time, pricing cache age, generation count
   */
  app.get("/api/cost/status", async (req: Request, res: Response) => {
    try {
      const scanner = app.locals.scanner as SessionLogScanner | undefined;
      const db = logger.getDatabase();

      const scannerStatus = scanner?.getStatus() ?? {
        running: false,
        lastScanTime: null,
        lastResult: null,
      };
      const pricingStatus = getPricingStatus();
      const summary = await db.getGenerationSummary();

      res.json({
        success: true,
        scanner: scannerStatus,
        pricing: pricingStatus,
        generations: {
          total: summary.totalGenerations,
          totalCost: summary.totalCost,
        },
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============================================================================
  // HEALTH & DIAGNOSTIC ENDPOINTS
  // ============================================================================

  /**
   * GET /api/health
   * Health check endpoint
   */
  app.get("/api/health", (req: Request, res: Response) => {
    res.json({
      success: true,
      status: "healthy",
      timestamp: new Date().toISOString(),
    });
  });

  // ============================================================================
  // REAL-TIME STREAMING ENDPOINTS
  // ============================================================================

  /**
   * GET /api/stream
   * Server-Sent Events endpoint for real-time activity updates
   */
  app.get("/api/stream", (req: Request, res: Response) => {
    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");

    // Send initial connection message
    res.write(":connected\n\n");

    // Add to active clients
    sseClients.add(res);
    console.log(`[SSE] Client connected. Active clients: ${sseClients.size}`);

    // Clean up on disconnect
    req.on("close", () => {
      sseClients.delete(res);
      console.log(
        `[SSE] Client disconnected. Active clients: ${sseClients.size}`,
      );
    });

    // Keep connection alive with heartbeat every 30s
    const heartbeatInterval = setInterval(() => {
      if (!res.writableEnded) {
        res.write(":heartbeat\n\n");
      } else {
        clearInterval(heartbeatInterval);
      }
    }, 30000);
  });

  // ============================================================================
  // UTILITY: Broadcast activity to SSE clients
  // ============================================================================

  /**
   * Internal function to broadcast new activities to connected clients
   */
  app.locals.broadcastActivity = (activity: Activity) => {
    const message = `data: ${JSON.stringify(activity)}\nevent: activity\n\n`;

    // Send to all connected SSE clients
    for (const client of sseClients) {
      if (!client.writableEnded) {
        client.write(message);
      } else {
        sseClients.delete(client);
      }
    }
  };

  /**
   * GET /api/pending-activities
   * Get all pending (in-progress) activities
   */
  app.get("/api/pending-activities", (req: Request, res: Response) => {
    try {
      const pending = logger.getPendingActivities();
      res.json({
        success: true,
        count: pending.length,
        activities: pending,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // ============================================================================
  // AGENTS ENDPOINTS
  // ============================================================================

  // Shared AgentService + SkillsService instances (filesystem-based)
  const fsAgentService = new AgentService(logger.getDatabase());
  const skillsService = new SkillsService(fsAgentService);

  /**
   * Validate agent/skill ID — alphanumeric, hyphens, and underscores only
   */
  function isValidId(id: string): boolean {
    return /^[a-zA-Z0-9_-]+$/.test(id);
  }

  /**
   * Build activity stats map keyed by **normalised** actor ID in a single O(n) pass.
   *
   * Activity records may store workspace-prefixed IDs (e.g. "workspace-engineer")
   * while the filesystem-derived agent IDs are short (e.g. "engineer").
   * We normalise every actor ID via `toActorId()` so the look-up in the agents
   * route always matches.
   *
   * Additionally merges timestamps from the `llm_generations` table — these may
   * be more recent than the activities table if the log scanner ran after the
   * last activity was ingested.
   */
  async function buildActivityStatsMap(): Promise<
    Map<
      string,
      {
        lastActive: string;
        sessions: Set<string>;
        totalCost: number;
        totalTokens: number;
        actionCount: number;
      }
    >
  > {
    const db = logger.getDatabase();
    const activities = await db.getActivities({ limit: 10000 });
    const statsMap = new Map<
      string,
      {
        lastActive: string;
        sessions: Set<string>;
        totalCost: number;
        totalTokens: number;
        actionCount: number;
      }
    >();

    for (const activity of activities) {
      // Normalise workspace-prefixed IDs → short IDs used by the filesystem
      const actorId = toActorId(activity.actor.id);
      if (!statsMap.has(actorId)) {
        statsMap.set(actorId, {
          lastActive: activity.timestamp,
          sessions: new Set<string>(),
          totalCost: 0,
          totalTokens: 0,
          actionCount: 0,
        });
      }
      const stats = statsMap.get(actorId)!;
      stats.totalCost += activity.cost?.usd || 0;
      stats.totalTokens += activity.tokens?.totalTokens || 0;
      stats.actionCount++;
      stats.sessions.add(activity.sessionId);
      if (new Date(activity.timestamp) > new Date(stats.lastActive)) {
        stats.lastActive = activity.timestamp;
      }
    }

    // Merge in LLM generation timestamps — these may be more recent than
    // the latest activity record and carry their own cost / token data.
    try {
      const genSummary = await db.getGenerationSummary();
      if (genSummary.byAgent) {
        for (const [agentId, genStats] of Object.entries(genSummary.byAgent)) {
          const normId = toActorId(agentId);
          if (!statsMap.has(normId)) {
            statsMap.set(normId, {
              lastActive: "",
              sessions: new Set<string>(),
              totalCost: 0,
              totalTokens: 0,
              actionCount: 0,
            });
          }
          const existing = statsMap.get(normId)!;
          // Generation cost/tokens supplement activity data — only add the
          // delta that isn't already captured by the activities table.  For
          // the timestamp, take the more recent of the two sources.
          // NOTE: we intentionally do NOT double-count cost/tokens here; the
          // generation table is the authoritative cost source once the
          // cost-linker has run.  We keep the activity-based numbers for now
          // because not all deployments have the scanner running.

          // Update lastActive to the more recent of activities vs generations
          if (
            genStats.lastActive &&
            (!existing.lastActive ||
              new Date(genStats.lastActive) > new Date(existing.lastActive))
          ) {
            existing.lastActive = genStats.lastActive;
          }
        }
      }
    } catch {
      // LLM generation tables may not exist yet — that's fine.
    }

    return statsMap;
  }

  /**
   * Strip the `location` field from a skill (avoid leaking filesystem paths)
   */
  function sanitizeSkill(skill: any): any {
    const { location, ...safe } = skill;
    return safe;
  }

  /**
   * GET /api/agents
   * Get all agents (from filesystem) merged with activity stats
   */
  app.get("/api/agents", async (req: Request, res: Response) => {
    try {
      const [fsAgents, statsMap] = await Promise.all([
        fsAgentService.readAgents(),
        buildActivityStatsMap(),
      ]);

      const agents = fsAgents.map((agent) => {
        const stats = statsMap.get(toActorId(agent.id));
        const lastActive = stats?.lastActive || "";
        const actionCount = stats?.actionCount || 0;
        const status = lastActive
          ? computeAgentStatus(new Date(lastActive), actionCount)
          : "offline";

        return {
          ...agent,
          status,
          lastActive,
          sessionCount: stats?.sessions.size || 0,
          totalCost: stats?.totalCost || 0,
          totalTokens: stats?.totalTokens || 0,
        };
      });

      res.json({
        success: true,
        count: agents.length,
        agents,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/agents/:id
   * Get a specific agent by ID (filesystem + activity stats)
   */
  app.get("/api/agents/:id", async (req: Request, res: Response) => {
    try {
      const agentId = req.params.id;
      if (!isValidId(agentId)) {
        return res.status(400).json({
          success: false,
          error: "Invalid agent ID",
        });
      }

      const agent = await fsAgentService.readAgent(agentId);
      if (!agent) {
        return res.status(404).json({
          success: false,
          error: "Agent not found",
        });
      }

      // Merge activity stats
      const statsMap = await buildActivityStatsMap();
      const stats = statsMap.get(toActorId(agentId));
      const lastActive = stats?.lastActive || "";
      const actionCount = stats?.actionCount || 0;
      const status = lastActive
        ? computeAgentStatus(new Date(lastActive), actionCount)
        : "offline";

      const detail: AgentDetail = {
        ...agent,
        status,
        lastActive,
        sessionCount: stats?.sessions.size || 0,
        totalCost: stats?.totalCost || 0,
        totalTokens: stats?.totalTokens || 0,
      };

      // Fetch legacy metadata (SOUL.md raw + config from openclaw.json)
      const metadata = await agentService.getAgentMetadata(agentId);
      if (metadata) {
        if (metadata.soulMarkdown) {
          detail.soulMarkdown = metadata.soulMarkdown;
        }
        if (metadata.config) {
          detail.config = metadata.config;
        }
      }

      res.json({
        success: true,
        agent: detail,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/agents/:id/soul
   * Get raw SOUL.md content for an agent
   */
  app.get("/api/agents/:id/soul", async (req: Request, res: Response) => {
    try {
      const agentId = req.params.id;
      if (!isValidId(agentId)) {
        return res.status(400).json({
          success: false,
          error: "Invalid agent ID",
        });
      }

      const content = await fsAgentService.readAgentSoul(agentId);
      if (!content) {
        return res.status(404).json({
          success: false,
          error: "Agent SOUL.md not found",
        });
      }

      res.json({
        success: true,
        content,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/agents/:id/activity
   * Get activity history for an agent
   */
  app.get("/api/agents/:id/activity", async (req: Request, res: Response) => {
    try {
      const agentId = req.params.id;
      if (!isValidId(agentId)) {
        return res.status(400).json({
          success: false,
          error: "Invalid agent ID",
        });
      }

      const limit = Math.min(
        Math.max(1, parseInt(req.query.limit as string) || 50),
        1000,
      );

      const activities = await fsAgentService.getAgentActivity(agentId, limit);

      // Enrich actor display names
      for (const activity of activities) {
        enrichActivityActor(activity);
      }

      res.json({
        success: true,
        count: activities.length,
        activities,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/agents/:id/skills
   * Get skills accessible to a specific agent
   */
  app.get("/api/agents/:id/skills", async (req: Request, res: Response) => {
    try {
      const agentId = req.params.id;
      if (!isValidId(agentId)) {
        return res.status(400).json({
          success: false,
          error: "Invalid agent ID",
        });
      }

      const agent = await fsAgentService.readAgent(agentId);
      if (!agent) {
        return res.status(404).json({
          success: false,
          error: "Agent not found",
        });
      }

      const skillIds = agent.skills || [];
      res.json({
        success: true,
        count: skillIds.length,
        skills: skillIds,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // ============================================================================
  // SKILLS ENDPOINTS
  // ============================================================================

  /**
   * GET /api/skills
   * List all skills (from filesystem)
   */
  app.get("/api/skills", async (req: Request, res: Response) => {
    try {
      const skills = await skillsService.readSkills();

      res.json({
        success: true,
        count: skills.length,
        skills: skills.map(sanitizeSkill),
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/skills/:id
   * Get a specific skill by ID
   */
  app.get("/api/skills/:id", async (req: Request, res: Response) => {
    try {
      const skillId = req.params.id;
      if (!isValidId(skillId)) {
        return res.status(400).json({
          success: false,
          error: "Invalid skill ID",
        });
      }

      const skill = await skillsService.readSkill(skillId);
      if (!skill) {
        return res.status(404).json({
          success: false,
          error: "Skill not found",
        });
      }

      res.json({
        success: true,
        skill: sanitizeSkill(skill),
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // ============================================================================
  // PERMISSIONS ENDPOINTS
  // ============================================================================

  /**
   * GET /api/permissions/matrix
   * Get the agents × skills permissions matrix
   */
  app.get("/api/permissions/matrix", async (req: Request, res: Response) => {
    try {
      const permMatrix = await skillsService.getPermissionsMatrix();

      res.json({
        success: true,
        agents: permMatrix.agents,
        skills: permMatrix.skills.map(sanitizeSkill),
        matrix: permMatrix.matrix,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // ============================================================================
  // CRON JOBS ENDPOINTS
  // ============================================================================

  /**
   * GET /api/cron/jobs
   * List all cron jobs with human-readable schedules
   */
  app.get("/api/cron/jobs", async (req: Request, res: Response) => {
    try {
      const jobs = await CronService.getJobs();
      res.json({
        success: true,
        jobs,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/cron/jobs/:id
   * Get details for a specific cron job
   */
  app.get("/api/cron/jobs/:id", async (req: Request, res: Response) => {
    try {
      const job = await CronService.getJob(req.params.id);
      if (!job) {
        return res.status(404).json({
          success: false,
          error: "Job not found",
        });
      }
      res.json({
        success: true,
        job,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/cron/jobs/:id/runs
   * Get execution history for a cron job
   */
  app.get("/api/cron/jobs/:id/runs", async (req: Request, res: Response) => {
    try {
      const limit = Math.min(
        Math.max(1, parseInt(req.query.limit as string) || 20),
        100,
      );
      const runs = await CronService.getRunHistory(req.params.id, limit);
      res.json({
        success: true,
        runs,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * POST /api/cron/jobs/:id/enable
   * Enable a cron job
   */
  app.post("/api/cron/jobs/:id/enable", async (req: Request, res: Response) => {
    try {
      const job = await CronService.getJob(req.params.id);
      if (!job) {
        return res.status(404).json({ success: false, error: "Job not found" });
      }
      // Proxy to `openclaw cron enable --id <id>`
      res.json({
        success: true,
        message: "Job enabled (via openclaw cron enable)",
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * POST /api/cron/jobs/:id/disable
   * Disable a cron job
   */
  app.post(
    "/api/cron/jobs/:id/disable",
    async (req: Request, res: Response) => {
      try {
        const job = await CronService.getJob(req.params.id);
        if (!job) {
          return res
            .status(404)
            .json({ success: false, error: "Job not found" });
        }
        // Proxy to `openclaw cron disable --id <id>`
        res.json({
          success: true,
          message: "Job disabled (via openclaw cron disable)",
        });
      } catch (error: any) {
        res.status(500).json({
          success: false,
          error: error.message,
        });
      }
    },
  );

  /**
   * POST /api/cron/jobs/:id/run
   * Manually trigger a cron job
   */
  app.post("/api/cron/jobs/:id/run", async (req: Request, res: Response) => {
    try {
      const job = await CronService.getJob(req.params.id);
      if (!job) {
        return res.status(404).json({ success: false, error: "Job not found" });
      }
      if (!job.enabled) {
        return res.status(400).json({
          success: false,
          error: "Job is disabled and cannot be run manually",
        });
      }
      // Proxy to `openclaw cron run --id <id>`
      res.json({
        success: true,
        message: "Job triggered (via openclaw cron run)",
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * DELETE /api/cron/jobs/:id
   * Delete a cron job
   */
  app.delete("/api/cron/jobs/:id", async (req: Request, res: Response) => {
    try {
      const job = await CronService.getJob(req.params.id);
      if (!job) {
        return res.status(404).json({ success: false, error: "Job not found" });
      }
      // Proxy to `openclaw cron rm --id <id>`
      res.json({
        success: true,
        message: "Job deleted (via openclaw cron rm)",
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // ============================================================================
  // SPA FALLBACK ROUTE (must be last)
  // ============================================================================

  /**
   * Serve index.html for all non-API routes (SPA routing)
   */
  app.get("*", (req: Request, res: Response) => {
    // Don't serve index.html for API routes
    if (!req.path.startsWith("/api")) {
      res.sendFile("dist-vite/index.html", { root: "." }, (err) => {
        if (err) {
          res.status(404).json({
            success: false,
            error: "Not found",
          });
        }
      });
    } else {
      res.status(404).json({
        success: false,
        error: "API endpoint not found",
      });
    }
  });
}
