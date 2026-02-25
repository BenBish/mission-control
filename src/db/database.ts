/**
 * Database Layer - SQLite wrapper
 * Handles all database operations with proper error handling
 */

import sqlite3 from "sqlite3";
import { open, Database as SqliteDatabase } from "sqlite";
import { getSQLStatements } from "./schema.js";
import {
  Activity,
  CreateActivityInput,
  UpdateActivityInput,
  ActivityFilter,
  SessionSummary,
} from "../types/activity.js";
import { AgentStats } from "../types/agents.js";
import { v7 as uuidv7 } from "uuid";

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
    if (!this.db) throw new Error("Database not initialized");

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
      try {
        // Ensure all statements are finalized
        await this.db.exec("PRAGMA integrity_check");
        await this.db.close();
      } catch (error) {
        // Try to close anyway even if there's an error
        console.warn("Error closing database:", error);
      } finally {
        this.db = null;
      }
    }
  }

  // ============================================================================
  // ACTIVITY OPERATIONS
  // ============================================================================

  /**
   * Create a new activity record
   */
  async createActivity(input: CreateActivityInput): Promise<Activity> {
    if (!this.db) throw new Error("Database not initialized");

    const activity: Activity = {
      id: uuidv7(),
      timestamp: new Date().toISOString(),
      status: input.status || "pending",
      ...input,
    };

    const stmt = await this.db.prepare(`
      INSERT INTO activities (
        id, session_id, parent_activity_id,
        timestamp, actor_type, actor_id, actor_role, actor_session_label,
        action_type, tool_name, description, details,
        status, tags, references_json, metadata
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
      activity.tags ? activity.tags.join(",") : null,
      activity.references ? JSON.stringify(activity.references) : null,
      activity.metadata ? JSON.stringify(activity.metadata) : null,
    );

    return activity;
  }

  /**
   * Update an existing activity record
   */
  async updateActivity(id: string, input: UpdateActivityInput): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");

    const updates: string[] = [];
    const values: any[] = [];

    if (input.status !== undefined) {
      updates.push("status = ?");
      values.push(input.status);
    }
    if (input.completedAt !== undefined) {
      updates.push("completed_at = ?");
      values.push(input.completedAt);
    }
    if (input.durationMs !== undefined) {
      updates.push("duration_ms = ?");
      values.push(input.durationMs);
    }
    if (input.result !== undefined) {
      updates.push("result = ?");
      values.push(JSON.stringify(input.result));
    }
    if (input.tokens !== undefined) {
      updates.push(
        "input_tokens = ?, output_tokens = ?, total_tokens = ?, model = ?",
      );
      values.push(
        input.tokens.inputTokens,
        input.tokens.outputTokens,
        input.tokens.totalTokens,
        input.tokens.model ?? null,
      );
    }
    if (input.cost !== undefined) {
      updates.push("cost_usd = ?");
      values.push(input.cost.usd);
    }

    if (updates.length === 0) return;

    values.push(id);
    const sql = `UPDATE activities SET ${updates.join(", ")} WHERE id = ?`;
    await this.db.run(sql, ...values);
  }

  /**
   * Get activity by ID
   */
  async getActivity(id: string): Promise<Activity | null> {
    if (!this.db) throw new Error("Database not initialized");

    const row = await this.db.get<any>(
      "SELECT * FROM activities WHERE id = ?",
      id,
    );

    return row ? this.parseActivityRow(row) : null;
  }

  /**
   * Get activities with optional filtering and pagination
   */
  async getActivities(filter: ActivityFilter = {}): Promise<Activity[]> {
    if (!this.db) throw new Error("Database not initialized");

    let sql = "SELECT * FROM activities WHERE 1=1";
    const values: any[] = [];

    if (filter.sessionId) {
      sql += " AND session_id = ?";
      values.push(filter.sessionId);
    }
    if (filter.actorId) {
      sql += " AND actor_id = ?";
      values.push(filter.actorId);
    }
    if (filter.actorType) {
      sql += " AND actor_type = ?";
      values.push(filter.actorType);
    }
    if (filter.actionType) {
      sql += " AND action_type = ?";
      values.push(filter.actionType);
    }
    if (filter.toolName) {
      sql += " AND tool_name = ?";
      values.push(filter.toolName);
    }
    if (filter.status) {
      sql += " AND status = ?";
      values.push(filter.status);
    }
    if (filter.startTime) {
      sql += " AND timestamp >= ?";
      values.push(filter.startTime);
    }
    if (filter.endTime) {
      sql += " AND timestamp <= ?";
      values.push(filter.endTime);
    }

    sql += " ORDER BY timestamp DESC";

    if (filter.limit) {
      sql += " LIMIT ?";
      values.push(filter.limit);
    }
    if (filter.offset) {
      sql += " OFFSET ?";
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
    if (!this.db) throw new Error("Database not initialized");

    await this.db.run(
      `INSERT OR IGNORE INTO sessions (id, start_time) VALUES (?, ?)`,
      sessionId,
      new Date().toISOString(),
    );
  }

  /**
   * Update session (mark as ended)
   */
  async updateSession(sessionId: string, endTime: string): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");

    await this.db.run(
      `UPDATE sessions SET end_time = ? WHERE id = ?`,
      endTime,
      sessionId,
    );
  }

  /**
   * Get session summary with computed statistics
   */
  async getSessionSummary(sessionId: string): Promise<SessionSummary | null> {
    if (!this.db) throw new Error("Database not initialized");

    const session = await this.db.get<any>(
      "SELECT * FROM sessions WHERE id = ?",
      sessionId,
    );

    if (!session) return null;

    // Get all activities for the session
    const activities = await this.getSessionActivities(sessionId);

    // Compute statistics
    const successCount = activities.filter(
      (a) => a.status === "success",
    ).length;
    const failureCount = activities.filter(
      (a) => a.status === "failure",
    ).length;
    const totalTokens = activities.reduce(
      (sum, a) => sum + (a.tokens?.totalTokens || 0),
      0,
    );
    const totalCost = activities.reduce(
      (sum, a) => sum + (a.cost?.usd || 0),
      0,
    );
    const avgDuration =
      activities.length > 0
        ? activities.reduce((sum, a) => sum + (a.durationMs || 0), 0) /
          activities.length
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
      if (activity.status === "success") {
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
        successRate:
          activities.length > 0 ? (successCount / activities.length) * 100 : 0,
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
  // AGENT STATS
  // ============================================================================

  /**
   * Get aggregated activity stats per agent
   */
  async getAgentStats(): Promise<Map<string, AgentStats>> {
    if (!this.db) throw new Error("Database not initialized");

    const rows = await this.db.all<any[]>(`
      SELECT
        actor_id,
        MAX(timestamp) as last_active,
        COUNT(DISTINCT session_id) as session_count,
        COALESCE(SUM(cost_usd), 0) as total_cost,
        COALESCE(SUM(total_tokens), 0) as total_tokens,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_count
      FROM activities
      GROUP BY actor_id
    `);

    const map = new Map<string, AgentStats>();
    for (const row of rows) {
      map.set(row.actor_id, {
        lastActive: row.last_active,
        sessionCount: row.session_count,
        totalCost: row.total_cost,
        totalTokens: row.total_tokens,
        pendingCount: row.pending_count,
      });
    }
    return map;
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
      tokens:
        row.input_tokens != null || row.output_tokens != null
          ? {
              inputTokens: row.input_tokens || 0,
              outputTokens: row.output_tokens || 0,
              totalTokens: row.total_tokens || 0,
              model: row.model,
            }
          : undefined,
      cost:
        row.cost_usd != null
          ? {
              usd: row.cost_usd,
            }
          : undefined,
      references: row.references_json
        ? JSON.parse(row.references_json)
        : undefined,
      tags: row.tags ? row.tags.split(",") : undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      createdAt: row.created_at,
    };
  }

  // ============================================================================
  // LLM GENERATION OPERATIONS
  // ============================================================================

  /**
   * Upsert an LLM generation record (from session log scanning)
   */
  async upsertGeneration(gen: {
    id: string;
    sessionLogFile: string;
    sessionLogMsgId: string;
    agentId: string;
    timestamp: string;
    model: string;
    provider?: string;
    stopReason?: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    totalTokens: number;
    costInput: number;
    costOutput: number;
    costCacheRead: number;
    costTotal: number;
  }): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");

    await this.db.run(
      `INSERT INTO llm_generations (
        id, session_log_file, session_log_msg_id, agent_id, timestamp,
        model, provider, stop_reason,
        input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, total_tokens,
        cost_input, cost_output, cost_cache_read, cost_total
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_log_file, session_log_msg_id) DO UPDATE SET
        cost_total = excluded.cost_total,
        total_tokens = excluded.total_tokens`,
      gen.id,
      gen.sessionLogFile,
      gen.sessionLogMsgId,
      gen.agentId,
      gen.timestamp,
      gen.model,
      gen.provider ?? null,
      gen.stopReason ?? null,
      gen.inputTokens,
      gen.outputTokens,
      gen.cacheReadTokens,
      gen.cacheWriteTokens,
      gen.totalTokens,
      gen.costInput,
      gen.costOutput,
      gen.costCacheRead,
      gen.costTotal,
    );
  }

  /**
   * Get LLM generations with optional filters
   */
  async getGenerations(
    filter: {
      agentId?: string;
      model?: string;
      startTime?: string;
      endTime?: string;
      unlinkedOnly?: boolean;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<any[]> {
    if (!this.db) throw new Error("Database not initialized");

    let sql = "SELECT * FROM llm_generations WHERE 1=1";
    const values: any[] = [];

    if (filter.agentId) {
      sql += " AND agent_id = ?";
      values.push(filter.agentId);
    }
    if (filter.model) {
      sql += " AND model = ?";
      values.push(filter.model);
    }
    if (filter.startTime) {
      sql += " AND timestamp >= ?";
      values.push(filter.startTime);
    }
    if (filter.endTime) {
      sql += " AND timestamp <= ?";
      values.push(filter.endTime);
    }
    if (filter.unlinkedOnly) {
      sql += " AND linked_activity_id IS NULL";
    }

    sql += " ORDER BY timestamp DESC";

    if (filter.limit) {
      sql += " LIMIT ?";
      values.push(filter.limit);
    }
    if (filter.offset) {
      sql += " OFFSET ?";
      values.push(filter.offset);
    }

    return this.db.all(sql, ...values);
  }

  /**
   * Link a generation to an activity
   */
  async linkGeneration(
    generationId: string,
    activityId: string,
  ): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");
    await this.db.run(
      "UPDATE llm_generations SET linked_activity_id = ? WHERE id = ?",
      activityId,
      generationId,
    );
  }

  /**
   * Get cost summary aggregated by agent and model
   */
  async getGenerationSummary(
    filter: {
      startTime?: string;
      endTime?: string;
    } = {},
  ): Promise<{
    totalCost: number;
    totalGenerations: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCacheReadTokens: number;
    byAgent: Record<
      string,
      { cost: number; generations: number; tokens: number; lastActive?: string }
    >;
    byModel: Record<
      string,
      { cost: number; generations: number; tokens: number }
    >;
  }> {
    if (!this.db) throw new Error("Database not initialized");

    let where = "WHERE 1=1";
    const values: any[] = [];
    if (filter.startTime) {
      where += " AND timestamp >= ?";
      values.push(filter.startTime);
    }
    if (filter.endTime) {
      where += " AND timestamp <= ?";
      values.push(filter.endTime);
    }

    const totals = await this.db.get<any>(
      `SELECT
        COALESCE(SUM(cost_total), 0) as total_cost,
        COUNT(*) as total_generations,
        COALESCE(SUM(input_tokens), 0) as total_input_tokens,
        COALESCE(SUM(output_tokens), 0) as total_output_tokens,
        COALESCE(SUM(cache_read_tokens), 0) as total_cache_read_tokens
      FROM llm_generations ${where}`,
      ...values,
    );

    const byAgent = await this.db.all<any[]>(
      `SELECT agent_id,
        SUM(cost_total) as cost,
        COUNT(*) as generations,
        SUM(total_tokens) as tokens,
        MAX(timestamp) as last_active
      FROM llm_generations ${where}
      GROUP BY agent_id ORDER BY cost DESC`,
      ...values,
    );

    const byModel = await this.db.all<any[]>(
      `SELECT model,
        SUM(cost_total) as cost,
        COUNT(*) as generations,
        SUM(total_tokens) as tokens
      FROM llm_generations ${where}
      GROUP BY model ORDER BY cost DESC`,
      ...values,
    );

    const agentMap: Record<
      string,
      { cost: number; generations: number; tokens: number; lastActive?: string }
    > = {};
    for (const row of byAgent) {
      agentMap[row.agent_id] = {
        cost: row.cost,
        generations: row.generations,
        tokens: row.tokens,
        lastActive: row.last_active || undefined,
      };
    }

    const modelMap: Record<
      string,
      { cost: number; generations: number; tokens: number }
    > = {};
    for (const row of byModel) {
      modelMap[row.model] = {
        cost: row.cost,
        generations: row.generations,
        tokens: row.tokens,
      };
    }

    return {
      totalCost: totals.total_cost,
      totalGenerations: totals.total_generations,
      totalInputTokens: totals.total_input_tokens,
      totalOutputTokens: totals.total_output_tokens,
      totalCacheReadTokens: totals.total_cache_read_tokens,
      byAgent: agentMap,
      byModel: modelMap,
    };
  }

  // ============================================================================
  // SCAN STATE OPERATIONS
  // ============================================================================

  /**
   * Get scan state for a file
   */
  async getScanState(filePath: string): Promise<{
    lastOffset: number;
    fileSize: number;
    lastScannedAt: string | null;
  } | null> {
    if (!this.db) throw new Error("Database not initialized");
    const row = await this.db.get<any>(
      "SELECT last_offset, file_size, last_scanned_at FROM scan_state WHERE file_path = ?",
      filePath,
    );
    if (!row) return null;
    return {
      lastOffset: row.last_offset,
      fileSize: row.file_size,
      lastScannedAt: row.last_scanned_at,
    };
  }

  /**
   * Update scan state for a file
   */
  async updateScanState(
    filePath: string,
    offset: number,
    fileSize: number,
  ): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");
    await this.db.run(
      `INSERT INTO scan_state (file_path, last_offset, file_size, last_scanned_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(file_path) DO UPDATE SET
         last_offset = excluded.last_offset,
         file_size = excluded.file_size,
         last_scanned_at = excluded.last_scanned_at`,
      filePath,
      offset,
      fileSize,
    );
  }

  /**
   * Reset all scan state (for full rescan)
   */
  async resetScanState(): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");
    await this.db.run("DELETE FROM scan_state");
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  /**
   * Clear all activities (for testing)
   */
  async clear(): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");
    await this.db.run("DELETE FROM activities");
    await this.db.run("DELETE FROM sessions");
    await this.db.run("DELETE FROM cost_summaries");
    await this.db.run("DELETE FROM llm_generations");
    await this.db.run("DELETE FROM scan_state");
  }

  /**
   * Get database statistics
   */
  async getStats(): Promise<{ activities: number; sessions: number }> {
    if (!this.db) throw new Error("Database not initialized");

    const activities = await this.db.get<{ count: number }>(
      "SELECT COUNT(*) as count FROM activities",
    );
    const sessions = await this.db.get<{ count: number }>(
      "SELECT COUNT(*) as count FROM sessions",
    );

    return {
      activities: activities?.count || 0,
      sessions: sessions?.count || 0,
    };
  }
}
