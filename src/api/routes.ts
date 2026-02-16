/**
 * API Routes
 * Express routes for activity feed endpoints
 */

import { Express, Request, Response } from 'express';
import { ActivityLogger } from '../logger/activity-logger.js';
import { ActivityFilter, Activity } from '../types/activity.js';

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

        // Transform incoming activity to CreateActivityInput format
        const dbActivity = {
          sessionId: activity.sessionId || activity.sessionKey || 'unknown-session',
          timestamp: activity.timestamp || new Date().toISOString(),
          actor: {
            id: activity.agentId || 'unknown',
            type: actorType as 'orchestrator' | 'subagent' | 'user' | 'system',
          },
          actionType: (actionTypeMap[activity.type] || 'event') as 'tool_call' | 'delegation' | 'api_call' | 'decision' | 'message' | 'event' | 'user_request' | 'agent_spawn' | 'session_start' | 'session_end',
          toolName: activity.toolName,
          description: `${activity.type} - ${activity.toolName || activity.sessionId || activity.sessionKey || 'N/A'}`,
          details: activity,
          status: activity.error ? 'failure' : (activity.success === false ? 'failure' : 'success'),
        };

        const createdActivity = await db.createActivity(dbActivity);
        created.push(createdActivity);

        // Broadcast to SSE clients
        if (app.locals.broadcastActivity) {
          app.locals.broadcastActivity(dbActivity);
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

      res.json({
        success: true,
        totalCost,
        totalTokens,
        activityCount: activities.length,
        actorCosts,
        toolCosts,
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
