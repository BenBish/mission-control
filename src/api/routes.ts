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

// Store active SSE clients
const sseClients: Set<Response> = new Set();

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
      const db = (logger as any).db;
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

      const db = (logger as any).db;
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
      const db = (logger as any).db;
      
      // Get all activities with tokens but no cost
      const activities = await db.getActivities({ limit: 100000 });
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
      const db = (logger as any).db;
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
      const db = (logger as any).db;
      const activities = await db.getActivities({ limit: 100000 });

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
      const db = (logger as any).db;
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
      const db = (logger as any).db;
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
      const db = (logger as any).db;
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
      const db = (logger as any).db;

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
  // SKILLS ENDPOINTS
  // ============================================================================

  /**
   * Seed sample skills data (only if empty)
   */
  async function seedSkillsIfEmpty(db: any) {
    const internalDb = db.db;
    const existing = await internalDb.get('SELECT COUNT(*) as count FROM skills');
    if (existing.count > 0) return;

    const skills = [
      { id: 'skill-1', name: 'File Operations', description: 'Read, write, and manage files in the workspace', category: 'Tools', location: 'filesystem' },
      { id: 'skill-2', name: 'Web Search', description: 'Search the web for information using Brave API', category: 'Tools', location: 'external' },
      { id: 'skill-3', name: 'Web Fetch', description: 'Fetch and extract content from URLs', category: 'Tools', location: 'external' },
      { id: 'skill-4', name: 'Code Execution', description: 'Execute shell commands and scripts', category: 'Tools', location: 'sandbox' },
      { id: 'skill-5', name: 'Browser Control', description: 'Control web browsers for automation', category: 'Tools', location: 'browser' },
      { id: 'skill-6', name: 'Message Sending', description: 'Send messages via channels like Telegram', category: 'Communication', location: 'telegram' },
      { id: 'skill-7', name: 'Node Management', description: 'Discover and control paired nodes', category: 'Management', location: 'nodes' },
      { id: 'skill-8', name: 'TTS Conversion', description: 'Convert text to speech for audio output', category: 'Media', location: 'audio' },
      { id: 'skill-9', name: 'Canvas Control', description: 'Control node canvases for presentation', category: 'Media', location: 'canvas' },
      { id: 'skill-10', name: 'Subagent Management', description: 'Spawn and manage sub-agents for complex tasks', category: 'Management', location: 'orchestrator' },
    ];

    const agentSkills = [
      { id: 'as-1', agentId: 'orchestrator', skillId: 'skill-1' },
      { id: 'as-2', agentId: 'orchestrator', skillId: 'skill-10' },
      { id: 'as-3', agentId: 'engineer-1', skillId: 'skill-1' },
      { id: 'as-4', agentId: 'engineer-1', skillId: 'skill-4' },
      { id: 'as-5', agentId: 'engineer-2', skillId: 'skill-1' },
      { id: 'as-6', agentId: 'engineer-2', skillId: 'skill-4' },
      { id: 'as-7', agentId: 'researcher', skillId: 'skill-2' },
      { id: 'as-8', agentId: 'researcher', skillId: 'skill-3' },
      { id: 'as-9', agentId: 'communicator', skillId: 'skill-6' },
      { id: 'as-10', agentId: 'communicator', skillId: 'skill-8' },
    ];

    for (const skill of skills) {
      await internalDb.run(
        'INSERT INTO skills (id, name, description, category, location) VALUES (?, ?, ?, ?, ?)',
        skill.id, skill.name, skill.description, skill.category, skill.location
      );
    }

    for (const as of agentSkills) {
      await internalDb.run(
        'INSERT INTO agent_skills (id, agent_id, skill_id) VALUES (?, ?, ?)',
        as.id, as.agentId, as.skillId
      );
    }

    console.log('[Skills] Seeded sample skills data');
  }

  /**
   * GET /api/skills
   * Get all skills with optional filtering and search
   */
  app.get('/api/skills', async (req: Request, res: Response) => {
    try {
      const db = (logger as any).db;
      const internalDb = db.db;
      const category = req.query.category as string | undefined;
      const search = req.query.search as string | undefined;

      // Seed data if empty
      await seedSkillsIfEmpty(db);

      // Build query
      let sql = `
        SELECT s.*, GROUP_CONCAT(as2.agent_id) as agent_ids
        FROM skills s
        LEFT JOIN agent_skills as2 ON s.id = as2.skill_id
        WHERE 1=1
      `;
      const params: any[] = [];

      if (category && category !== 'all') {
        sql += ' AND s.category = ?';
        params.push(category);
      }

      if (search) {
        sql += ' AND (s.name LIKE ? OR s.description LIKE ?)';
        params.push(`%${search}%`, `%${search}%`);
      }

      sql += ' GROUP BY s.id ORDER BY s.category, s.name';

      const rows = await internalDb.all(sql, ...params);

      // Get unique categories
      const categoryRows = await internalDb.all('SELECT DISTINCT category FROM skills ORDER BY category');
      const categories = categoryRows.map((r: any) => r.category);

      const skills = rows.map((row: any) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        category: row.category,
        location: row.location,
        agentIds: row.agent_ids ? row.agent_ids.split(',') : [],
      }));

      res.json({
        success: true,
        skills,
        categories,
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
  app.get('/api/agents/:id/skills', async (req: Request, res: Response) => {
    try {
      const db = (logger as any).db;
      const internalDb = db.db;
      const agentId = req.params.id;

      // Validate agent ID format (basic check for non-empty string)
      if (!agentId || typeof agentId !== 'string' || agentId.trim() === '') {
        return res.status(400).json({ error: 'Invalid agent ID' });
      }

      // Check if agent exists by checking agent_skills table
      const agentCheck = await internalDb.get(`
        SELECT DISTINCT agent_id FROM agent_skills WHERE agent_id = ?
      `, agentId);

      if (!agentCheck) {
        return res.status(404).json({ error: 'Agent not found' });
      }

      const rows = await internalDb.all(`
        SELECT s.*, GROUP_CONCAT(as2.agent_id) as agent_ids
        FROM skills s
        INNER JOIN agent_skills as2 ON s.id = as2.skill_id
        WHERE as2.agent_id = ?
        GROUP BY s.id
        ORDER BY s.category, s.name
      `, agentId);

      const skills = rows.map((row: any) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        category: row.category,
        location: row.location,
        agentIds: row.agent_ids ? row.agent_ids.split(',') : [],
      }));

      res.json({
        success: true,
        agentId,
        skills,
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
  app.get('/api/skills/:id', async (req: Request, res: Response) => {
    try {
      const db = (logger as any).db;
      const internalDb = db.db;
      const skillId = req.params.id;

      const row = await internalDb.get(`
        SELECT s.*, GROUP_CONCAT(as2.agent_id) as agent_ids
        FROM skills s
        LEFT JOIN agent_skills as2 ON s.id = as2.skill_id
        WHERE s.id = ?
        GROUP BY s.id
      `, skillId);

      if (!row) {
        return res.status(404).json({
          success: false,
          error: 'Skill not found',
        });
      }

      res.json({
        success: true,
        skill: {
          id: row.id,
          name: row.name,
          description: row.description,
          category: row.category,
          location: row.location,
          agentIds: row.agent_ids ? row.agent_ids.split(',') : [],
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
