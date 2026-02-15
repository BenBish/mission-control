/**
 * Database Layer - SQLite wrapper
 * Handles all database operations with proper error handling
 */

import sqlite3 from 'sqlite3';
import { open, Database as SqliteDatabase } from 'sqlite';
import { getSQLStatements } from './schema.js';
import { Activity, CreateActivityInput, UpdateActivityInput, ActivityFilter, SessionSummary } from '../types/activity.js';
import { v7 as uuidv7 } from 'uuid';

export class Database {
  private db: SqliteDatabase | null = null;

  constructor(private dbPath: string) {}

  /**
   * Initialize database connection and run migrations
   */
  async initialize(): Promise<void> {
    this.db = await open({
      filename: this.dbPath,
      driver: sqlite3.Database,
    });

    await this.migrate();
    console.log(`✓ Database initialized at ${this.dbPath}`);
  }

  /**
   * Run all schema migrations
   */
  private async migrate(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const statements = getSQLStatements();
    for (const stmt of statements) {
      await this.db.exec(stmt);
    }
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
  }

  // ============================================================================
  // ACTIVITY OPERATIONS
  // ============================================================================

  /**
   * Create a new activity record
   */
  async createActivity(input: CreateActivityInput): Promise<Activity> {
    if (!this.db) throw new Error('Database not initialized');

    const activity: Activity = {
      id: uuidv7(),
      timestamp: new Date().toISOString(),
      status: 'pending',
      ...input,
    };

    const stmt = await this.db.prepare(`
      INSERT INTO activities (
        id, session_id, parent_activity_id,
        timestamp, actor_type, actor_id, actor_role, actor_session_label,
        action_type, tool_name, description, details,
        status, tags, references, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    await stmt.run(
      activity.id,
      activity.sessionId,
      activity.parentActivityId ?? null,
      activity.timestamp,
      activity.actor.type,
      activity.actor.id,
      activity.actor.role ?? null,
      activity.actor.sessionLabel ?? null,
      activity.actionType,
      activity.toolName ?? null,
      activity.description,
      activity.details ? JSON.stringify(activity.details) : null,
      activity.status,
      activity.tags ? activity.tags.join(',') : null,
      activity.references ? JSON.stringify(activity.references) : null,
      activity.metadata ? JSON.stringify(activity.metadata) : null
    );

    return activity;
  }

  /**
   * Update an existing activity record
   */
  async updateActivity(id: string, input: UpdateActivityInput): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const updates: string[] = [];
    const values: any[] = [];

    if (input.status !== undefined) {
      updates.push('status = ?');
      values.push(input.status);
    }
    if (input.completedAt !== undefined) {
      updates.push('completed_at = ?');
      values.push(input.completedAt);
    }
    if (input.durationMs !== undefined) {
      updates.push('duration_ms = ?');
      values.push(input.durationMs);
    }
    if (input.result !== undefined) {
      updates.push('result = ?');
      values.push(JSON.stringify(input.result));
    }
    if (input.tokens !== undefined) {
      updates.push('input_tokens = ?, output_tokens = ?, total_tokens = ?, model = ?');
      values.push(
        input.tokens.inputTokens,
        input.tokens.outputTokens,
        input.tokens.totalTokens,
        input.tokens.model ?? null
      );
    }
    if (input.cost !== undefined) {
      updates.push('cost_usd = ?');
      values.push(input.cost.usd);
    }

    if (updates.length === 0) return;

    values.push(id);
    const sql = `UPDATE activities SET ${updates.join(', ')} WHERE id = ?`;
    await this.db.run(sql, ...values);
  }

  /**
   * Get activity by ID
   */
  async getActivity(id: string): Promise<Activity | null> {
    if (!this.db) throw new Error('Database not initialized');

    const row = await this.db.get<any>(
      'SELECT * FROM activities WHERE id = ?',
      id
    );

    return row ? this.parseActivityRow(row) : null;
  }

  /**
   * Get activities with optional filtering and pagination
   */
  async getActivities(filter: ActivityFilter = {}): Promise<Activity[]> {
    if (!this.db) throw new Error('Database not initialized');

    let sql = 'SELECT * FROM activities WHERE 1=1';
    const values: any[] = [];

    if (filter.sessionId) {
      sql += ' AND session_id = ?';
      values.push(filter.sessionId);
    }
    if (filter.actorId) {
      sql += ' AND actor_id = ?';
      values.push(filter.actorId);
    }
    if (filter.actorType) {
      sql += ' AND actor_type = ?';
      values.push(filter.actorType);
    }
    if (filter.actionType) {
      sql += ' AND action_type = ?';
      values.push(filter.actionType);
    }
    if (filter.toolName) {
      sql += ' AND tool_name = ?';
      values.push(filter.toolName);
    }
    if (filter.status) {
      sql += ' AND status = ?';
      values.push(filter.status);
    }
    if (filter.startTime) {
      sql += ' AND timestamp >= ?';
      values.push(filter.startTime);
    }
    if (filter.endTime) {
      sql += ' AND timestamp <= ?';
      values.push(filter.endTime);
    }

    sql += ' ORDER BY timestamp DESC';

    if (filter.limit) {
      sql += ' LIMIT ?';
      values.push(filter.limit);
    }
    if (filter.offset) {
      sql += ' OFFSET ?';
      values.push(filter.offset);
    }

    const rows = await this.db.all<any[]>(sql, ...values);
    return rows.map((row) => this.parseActivityRow(row));
  }

  /**
   * Get activities for a session
   */
  async getSessionActivities(sessionId: string): Promise<Activity[]> {
    return this.getActivities({ sessionId });
  }

  // ============================================================================
  // SESSION OPERATIONS
  // ============================================================================

  /**
   * Create a new session
   */
  async createSession(sessionId: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    await this.db.run(
      `INSERT OR IGNORE INTO sessions (id, start_time) VALUES (?, ?)`,
      sessionId,
      new Date().toISOString()
    );
  }

  /**
   * Update session (mark as ended)
   */
  async updateSession(sessionId: string, endTime: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    await this.db.run(
      `UPDATE sessions SET end_time = ? WHERE id = ?`,
      endTime,
      sessionId
    );
  }

  /**
   * Get session summary with computed statistics
   */
  async getSessionSummary(sessionId: string): Promise<SessionSummary | null> {
    if (!this.db) throw new Error('Database not initialized');

    const session = await this.db.get<any>(
      'SELECT * FROM sessions WHERE id = ?',
      sessionId
    );

    if (!session) return null;

    // Get all activities for the session
    const activities = await this.getSessionActivities(sessionId);

    // Compute statistics
    const successCount = activities.filter((a) => a.status === 'success').length;
    const failureCount = activities.filter((a) => a.status === 'failure').length;
    const totalTokens = activities.reduce((sum, a) => sum + (a.tokens?.totalTokens || 0), 0);
    const totalCost = activities.reduce((sum, a) => sum + (a.cost?.usd || 0), 0);
    const avgDuration =
      activities.length > 0
        ? activities.reduce((sum, a) => sum + (a.durationMs || 0), 0) / activities.length
        : 0;

    // Group by actor
    const actors: Record<string, any> = {};
    for (const activity of activities) {
      if (!actors[activity.actor.id]) {
        actors[activity.actor.id] = {
          name: activity.actor.id,
          actionsCount: 0,
          successCount: 0,
          tokensUsed: 0,
          costUsd: 0,
        };
      }
      actors[activity.actor.id].actionsCount++;
      if (activity.status === 'success') {
        actors[activity.actor.id].successCount++;
      }
      actors[activity.actor.id].tokensUsed += activity.tokens?.totalTokens || 0;
      actors[activity.actor.id].costUsd += activity.cost?.usd || 0;
    }

    // Get top tools
    const toolStats: Record<string, { count: number; cost: number }> = {};
    for (const activity of activities) {
      if (activity.toolName) {
        if (!toolStats[activity.toolName]) {
          toolStats[activity.toolName] = { count: 0, cost: 0 };
        }
        toolStats[activity.toolName].count++;
        toolStats[activity.toolName].cost += activity.cost?.usd || 0;
      }
    }

    const topTools = Object.entries(toolStats)
      .map(([name, stats]) => ({ name, ...stats }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 5);

    return {
      sessionId,
      startTime: session.start_time,
      endTime: session.end_time,
      stats: {
        totalActions: activities.length,
        successCount,
        failureCount,
        successRate: activities.length > 0 ? (successCount / activities.length) * 100 : 0,
        totalTokens,
        totalCost,
        avgActionDuration: avgDuration,
      },
      actors,
      topTools,
      events: [],
    };
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  /**
   * Parse a database row into an Activity object
   */
  private parseActivityRow(row: any): Activity {
    return {
      id: row.id,
      sessionId: row.session_id,
      parentActivityId: row.parent_activity_id,
      timestamp: row.timestamp,
      completedAt: row.completed_at,
      durationMs: row.duration_ms,
      actor: {
        type: row.actor_type,
        id: row.actor_id,
        role: row.actor_role,
        sessionLabel: row.actor_session_label,
      },
      actionType: row.action_type,
      toolName: row.tool_name,
      description: row.description,
      details: row.details ? JSON.parse(row.details) : undefined,
      status: row.status,
      result: row.result ? JSON.parse(row.result) : undefined,
      tokens: row.input_tokens
        ? {
            inputTokens: row.input_tokens,
            outputTokens: row.output_tokens,
            totalTokens: row.total_tokens,
            model: row.model,
          }
        : undefined,
      cost: row.cost_usd
        ? {
            usd: row.cost_usd,
          }
        : undefined,
      references: row.references ? JSON.parse(row.references) : undefined,
      tags: row.tags ? row.tags.split(',') : undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      createdAt: row.created_at,
    };
  }

  /**
   * Clear all activities (for testing)
   */
  async clear(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    await this.db.run('DELETE FROM activities');
    await this.db.run('DELETE FROM sessions');
    await this.db.run('DELETE FROM cost_summaries');
  }

  /**
   * Get database statistics
   */
  async getStats(): Promise<{ activities: number; sessions: number }> {
    if (!this.db) throw new Error('Database not initialized');

    const activities = await this.db.get<{ count: number }>(
      'SELECT COUNT(*) as count FROM activities'
    );
    const sessions = await this.db.get<{ count: number }>(
      'SELECT COUNT(*) as count FROM sessions'
    );

    return {
      activities: activities?.count || 0,
      sessions: sessions?.count || 0,
    };
  }
}
