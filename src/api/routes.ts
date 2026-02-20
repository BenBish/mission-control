/**
 * API Routes
 * Express routes for activity feed endpoints
 */

import { Express, Request, Response } from 'express';
import { ActivityLogger } from '../logger/activity-logger.js';
import { ActivityFilter, Activity, TokenInfo, CostInfo } from '../types/activity.js';
import { calculateCost, getPricingStatus } from '../types/pricing.js';
import type { SessionLogScanner } from '../services/session-log-scanner.js';
import type { CostLinker } from '../services/cost-linker.js';
import { AgentService } from '../services/agent-service.js';
import { SkillsService } from '../services/skills-service.js';

// Store active SSE clients
const sseClients: Set<Response> = new Set();

// Validation regex for safe IDs (alphanumeric and hyphens only)
const VALID_ID_REGEX = /^[a-z0-9-]+$/i;

// Default limits for activity queries
const DEFAULT_ACTIVITY_LIMIT = 100;
const MAX_ACTIVITY_LIMIT = 100000;

export function setupRoutes(app: Express, logger: ActivityLogger) {
  // ============================================================================
  // ACTIVITY ENDPOINTS
  // ============================================================================

  /**
   * GET /api/activities
   * Get activities with optional filtering
   */
  app.get('/api/activities', async (req: Request, res: Response) => {
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

      const activities = await logger.getActivity('') || [];
      
      // Fetch activities from database
      const db = logger.getDatabase();
      const results = await db.getActivities(filter);

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
  app.post('/api/activities', async (req: Request, res: Response) => {
    try {
      const { activities } = req.body;
      if (!activities || !Array.isArray(activities)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid request: expected { activities: [...] }',
        });
      }

      const db = logger.getDatabase();
      const created = [];

      for (const activity of activities) {
        // Map plugin activity type to database actionType
        const actionTypeMap: Record<string, string> = {
          'tool_execution': 'tool_call',
          'message_received': 'message',
          'message_sent': 'message',
          'agent_run': 'decision',
          'session_start': 'session_start',
          'session_end': 'session_end',
          'model_usage': 'api_call',
          'session_state': 'event',
          'queue_event': 'event',
        };

        // Map plugin activity type to actor type
        const actorTypeMap: Record<string, string> = {
          'session_start': 'orchestrator',
          'session_end': 'orchestrator',
          'agent_run': 'subagent',
        };

        // Determine the correct actor type based on activity type
        let actorType = actorTypeMap[activity.type] || 'subagent';
        if (activity.type.startsWith('session')) {
          actorType = 'orchestrator';
        }

        // Extract model and tokens from activity
        const model = activity.model || activity.details?.model;
        const tokens: TokenInfo | undefined = activity.tokens ? {
          inputTokens: activity.tokens.input || 0,
          outputTokens: activity.tokens.output || 0,
          totalTokens: activity.tokens.total || (activity.tokens.input || 0) + (activity.tokens.output || 0),
          model,
        } : undefined;

        // Calculate cost if tokens provided
        let cost: CostInfo | undefined;
        if (activity.costUsd !== undefined) {
          cost = { usd: activity.costUsd };
        } else if (tokens && model) {
          const calculatedCost = calculateCost(model, tokens.inputTokens, tokens.outputTokens);
          if (calculatedCost > 0) {
            cost = { usd: calculatedCost };
          }
        }

        // Transform incoming activity to CreateActivityInput format
        const dbActivity = {
          sessionId: activity.sessionId || activity.sessionKey || 'unknown-session',
          timestamp: activity.timestamp || new Date().toISOString(),
          actor: {
            id: activity.agentId || activity.actor?.id || 'unknown',
            type: actorType as 'orchestrator' | 'subagent' | 'user' | 'system',
          },
          actionType: (actionTypeMap[activity.type] || 'event') as 'tool_call' | 'delegation' | 'api_call' | 'decision' | 'message' | 'event' | 'user_request' | 'agent_spawn' | 'session_start' | 'session_end',
          toolName: activity.toolName,
          description: `${activity.type} - ${activity.toolName || activity.sessionId || activity.sessionKey || 'N/A'}`,
          details: activity,
          status: activity.error ? 'failure' : (activity.success === false ? 'failure' : 'success'),
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

        created.push(createdActivity);

        // Broadcast to SSE clients
        if (app.locals.broadcastActivity) {
          app.locals.broadcastActivity({
            ...dbActivity,
            id: createdActivity.id,
            tokens,
            cost,
          } as Activity);
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
  app.post('/api/activities/backfill', async (req: Request, res: Response) => {
    try {
      const db = logger.getDatabase();
      
      // Get all activities with tokens but no cost
      const activities = await db.getActivities({ limit: MAX_ACTIVITY_LIMIT });
      const activitiesToUpdate = activities.filter((a: Activity) => 
        a.tokens && 
        a.tokens.totalTokens > 0 && 
        (!a.cost || a.cost.usd === 0)
      );

      let updatedCount = 0;
      let totalCostAdded = 0;

      for (const activity of activitiesToUpdate) {
        if (!activity.tokens) continue;

        const model = activity.tokens.model || activity.metadata?.model || 'default';
        const calculatedCost = calculateCost(
          model,
          activity.tokens.inputTokens,
          activity.tokens.outputTokens
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
  app.get('/api/activities/:id', async (req: Request, res: Response) => {
    try {
      const activity = await logger.getActivity(req.params.id);
      if (!activity) {
        return res.status(404).json({
          success: false,
          error: 'Activity not found',
        });
      }

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
  app.get('/api/activities/search', async (req: Request, res: Response) => {
    try {
      const query = req.query.q as string;
      if (!query) {
        return res.status(400).json({
          success: false,
          error: 'Query parameter required',
        });
      }

      // Get all activities and filter (simple implementation)
      const db = logger.getDatabase();
      const activities = await db.getActivities({ limit: 1000 });
      const filtered = activities.filter(
        (a: Activity) =>
          a.description.toLowerCase().includes(query.toLowerCase()) ||
          a.toolName?.toLowerCase().includes(query.toLowerCase()) ||
          JSON.stringify(a.details).toLowerCase().includes(query.toLowerCase())
      );

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
  app.get('/api/sessions/:id', async (req: Request, res: Response) => {
    try {
      const summary = await logger.getSessionSummary(req.params.id);
      if (!summary) {
        return res.status(404).json({
          success: false,
          error: 'Session not found',
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
  app.get('/api/sessions/:id/activities', async (req: Request, res: Response) => {
    try {
      const activities = await logger.getSessionActivities(req.params.id);
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
   * GET /api/sessions/:id/cost-report
   * Get cost breakdown for a session
   */
  app.get('/api/sessions/:id/cost-report', async (req: Request, res: Response) => {
    try {
      const summary = await logger.getSessionSummary(req.params.id);
      if (!summary) {
        return res.status(404).json({
          success: false,
          error: 'Session not found',
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
  });

  // ============================================================================
  // AGGREGATION & REPORTING ENDPOINTS
  // ============================================================================

  /**
   * GET /api/cost-report
   * Get overall cost aggregation across all sessions
   */
  app.get('/api/cost-report', async (req: Request, res: Response) => {
    try {
      const db = logger.getDatabase();
      const activities = await db.getActivities({ limit: MAX_ACTIVITY_LIMIT });

      let totalCost = 0;
      let totalTokens = 0;
      const actorCosts: Record<string, { cost: number; tokens: number; actions: number }> = {};
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
        totalTokens: generationSummary ? generationSummary.totalInputTokens + generationSummary.totalOutputTokens : totalTokens,
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
  app.get('/api/stats', async (req: Request, res: Response) => {
    try {
      const db = logger.getDatabase();
      const stats = await db.getStats();
      const activities = await db.getActivities({ limit: 1000 });

      const success = activities.filter((a: Activity) => a.status === 'success').length;
      const failure = activities.filter((a: Activity) => a.status === 'failure').length;
      const totalCost = activities.reduce((sum: number, a: Activity) => sum + (a.cost?.usd || 0), 0);
      const totalTokens = activities.reduce((sum: number, a: Activity) => sum + (a.tokens?.totalTokens || 0), 0);

      res.json({
        success: true,
        stats: {
          ...stats,
          successCount: success,
          failureCount: failure,
          successRate: activities.length > 0 ? (success / activities.length) * 100 : 0,
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
  app.post('/api/cost/scan', async (req: Request, res: Response) => {
    try {
      const scanner = app.locals.scanner as SessionLogScanner | undefined;
      if (!scanner) {
        return res.status(503).json({ success: false, error: 'Scanner not initialized' });
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
  app.post('/api/cost/backfill', async (req: Request, res: Response) => {
    try {
      const scanner = app.locals.scanner as SessionLogScanner | undefined;
      const costLinker = app.locals.costLinker as CostLinker | undefined;
      if (!scanner) {
        return res.status(503).json({ success: false, error: 'Scanner not initialized' });
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
  app.get('/api/cost/generations', async (req: Request, res: Response) => {
    try {
      const db = logger.getDatabase();
      const generations = await db.getGenerations({
        agentId: req.query.agentId as string | undefined,
        model: req.query.model as string | undefined,
        startTime: req.query.startTime as string | undefined,
        endTime: req.query.endTime as string | undefined,
        unlinkedOnly: req.query.unlinkedOnly === 'true',
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
  app.get('/api/cost/summary', async (req: Request, res: Response) => {
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
  app.get('/api/cost/status', async (req: Request, res: Response) => {
    try {
      const scanner = app.locals.scanner as SessionLogScanner | undefined;
      const db = logger.getDatabase();

      const scannerStatus = scanner?.getStatus() ?? { running: false, lastScanTime: null, lastResult: null };
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
  app.get('/api/health', (req: Request, res: Response) => {
    res.json({
      success: true,
      status: 'healthy',
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
  app.get('/api/stream', (req: Request, res: Response) => {
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Send initial connection message
    res.write(':connected\n\n');

    // Add to active clients
    sseClients.add(res);
    console.log(`[SSE] Client connected. Active clients: ${sseClients.size}`);

    // Clean up on disconnect
    req.on('close', () => {
      sseClients.delete(res);
      console.log(`[SSE] Client disconnected. Active clients: ${sseClients.size}`);
    });

    // Keep connection alive with heartbeat every 30s
    const heartbeatInterval = setInterval(() => {
      if (!res.writableEnded) {
        res.write(':heartbeat\n\n');
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
  app.get('/api/pending-activities', (req: Request, res: Response) => {
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
  // AGENT ENDPOINTS
  // ============================================================================

  /**
   * Initialize services
   */
  const agentService = new AgentService();
  const db = logger.getDatabase();
  if (db) {
    agentService.setDatabase(db);
  }
  const skillsService = new SkillsService(agentService);

  /**
   * GET /api/agents
   * List all agents with metadata
   */
  app.get('/api/agents', async (req: Request, res: Response) => {
    try {
      const agents = await agentService.readAgents();
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
   * Get agent details
   */
  app.get('/api/agents/:id', async (req: Request, res: Response) => {
    try {
      const id = req.params.id;
      if (!VALID_ID_REGEX.test(id)) {
        return res.status(400).json({ success: false, error: 'Invalid agent ID' });
      }
      const agent = await agentService.readAgent(id);
      if (!agent) {
        return res.status(404).json({
          success: false,
          error: 'Agent not found',
        });
      }

      res.json({
        success: true,
        agent,
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
   * Get raw SOUL.md content
   */
  app.get('/api/agents/:id/soul', async (req: Request, res: Response) => {
    try {
      const id = req.params.id;
      if (!VALID_ID_REGEX.test(id)) {
        return res.status(400).json({ success: false, error: 'Invalid agent ID' });
      }
      const soul = await agentService.readAgentSoul(id);
      if (soul === null) {
        return res.status(404).json({
          success: false,
          error: 'Agent SOUL.md not found',
        });
      }

      res.json({
        success: true,
        content: soul,
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
   * Get agent's recent activities
   */
  app.get('/api/agents/:id/activity', async (req: Request, res: Response) => {
    try {
      const id = req.params.id;
      if (!VALID_ID_REGEX.test(id)) {
        return res.status(400).json({ success: false, error: 'Invalid agent ID' });
      }
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
      const activities = await agentService.getAgentActivity(id, limit);
      
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
   * Get skills accessible to agent
   */
  app.get('/api/agents/:id/skills', async (req: Request, res: Response) => {
    try {
      const id = req.params.id;
      if (!VALID_ID_REGEX.test(id)) {
        return res.status(400).json({ success: false, error: 'Invalid agent ID' });
      }
      const agent = await agentService.readAgent(id);
      if (!agent) {
        return res.status(404).json({
          success: false,
          error: 'Agent not found',
        });
      }

      const skills = agent.skills || [];

      res.json({
        success: true,
        count: skills.length,
        skills,
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
   * List all skills
   */
  app.get('/api/skills', async (req: Request, res: Response) => {
    try {
      const skills = await skillsService.readSkills();
      // Strip internal-only fields (location contains absolute filesystem paths)
      const sanitized = skills.map(({ location, ...rest }) => rest);
      res.json({
        success: true,
        count: sanitized.length,
        skills: sanitized,
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
   * Get skill details
   */
  app.get('/api/skills/:id', async (req: Request, res: Response) => {
    try {
      const id = req.params.id;
      if (!VALID_ID_REGEX.test(id)) {
        return res.status(400).json({ success: false, error: 'Invalid skill ID' });
      }
      const skill = await skillsService.readSkill(id);
      if (!skill) {
        return res.status(404).json({
          success: false,
          error: 'Skill not found',
        });
      }

      // Strip internal-only fields (location contains absolute filesystem paths)
      const { location, ...sanitized } = skill;
      res.json({
        success: true,
        skill: sanitized,
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
   * Get agent × skill access matrix
   */
  app.get('/api/permissions/matrix', async (req: Request, res: Response) => {
    try {
      const matrix = await skillsService.getPermissionsMatrix();
      res.json({
        success: true,
        agents: matrix.agents,
        skills: matrix.skills,
        matrix: matrix.matrix,
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
  app.get('*', (req: Request, res: Response) => {
    // Don't serve index.html for API routes
    if (!req.path.startsWith('/api')) {
      res.sendFile('dist-vite/index.html', { root: '.' }, (err) => {
        if (err) {
          res.status(404).json({
            success: false,
            error: 'Not found',
          });
        }
      });
    } else {
      res.status(404).json({
        success: false,
        error: 'API endpoint not found',
      });
    }
  });
}
