/**
 * Cost Linker
 * Correlates LLM generations from session logs with Mission Control activities.
 *
 * Linking strategy:
 * 1. Session key matching — extract UUID from activity sessionKey and match to JSONL filename
 * 2. Timestamp correlation — pair generations to activities by timestamp proximity
 * 3. Agent ID matching — match generation agent_id to activity actor_id
 */

import { Database } from '../db/database.js';
import { Activity } from '../types/activity.js';

interface Generation {
  id: string;
  session_log_file: string;
  session_log_msg_id: string;
  agent_id: string;
  timestamp: string;
  model: string;
  provider?: string;
  stop_reason?: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  total_tokens: number;
  cost_input: number;
  cost_output: number;
  cost_cache_read: number;
  cost_total: number;
  linked_activity_id?: string;
}

export interface LinkResult {
  linked: number;
  activitiesUpdated: number;
  totalCostAttributed: number;
}

export class CostLinker {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Link unlinked generations to activities and update activity costs.
   * Called after each scanner pass.
   */
  async link(): Promise<LinkResult> {
    const result: LinkResult = { linked: 0, activitiesUpdated: 0, totalCostAttributed: 0 };

    try {
      // Get all unlinked generations
      const unlinked = await this.db.getGenerations({ unlinkedOnly: true, limit: 1000 });
      if (unlinked.length === 0) return result;

      for (const gen of unlinked) {
        const activityId = await this.findMatchingActivity(gen);
        if (activityId) {
          await this.db.linkGeneration(gen.id, activityId);
          result.linked++;
        }
      }

      // Update activities with aggregated costs from linked generations
      const updated = await this.updateActivityCosts();
      result.activitiesUpdated = updated.activitiesUpdated;
      result.totalCostAttributed = updated.totalCostAttributed;

      if (result.linked > 0) {
        console.log(`[CostLinker] Linked ${result.linked} generations, updated ${result.activitiesUpdated} activities ($${result.totalCostAttributed.toFixed(4)})`);
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error('[CostLinker] Error:', errorMessage);
    }

    return result;
  }

  /**
   * Find the best matching activity for a generation.
   */
  private async findMatchingActivity(gen: Generation): Promise<string | null> {
    // Strategy 1: Match by session file UUID to activity sessionId
    const sessionUuid = this.extractSessionUuid(gen.session_log_file);

    // Try to find an activity in the same session with matching agent and close timestamp
    const candidates = await this.db.getActivities({
      actorId: gen.agent_id,
      limit: 500,
    });

    if (candidates.length === 0) return null;

    const genTime = new Date(gen.timestamp).getTime();

    // Strategy 2: Session key matching — activity sessionId contains the session UUID
    if (sessionUuid) {
      const sessionMatches = candidates.filter(a =>
        a.sessionId.includes(sessionUuid)
      );
      if (sessionMatches.length > 0) {
        return this.findClosestByTimestamp(sessionMatches, genTime);
      }
    }

    // Strategy 3: Pure timestamp + agent matching — find closest activity within 60s window
    return this.findClosestByTimestamp(candidates, genTime, 60_000);
  }

  /**
   * Find the activity closest in time to the generation timestamp.
   */
  private findClosestByTimestamp(activities: Activity[], genTimeMs: number, maxDeltaMs?: number): string | null {
    let best: { id: string; delta: number } | null = null;

    for (const activity of activities) {
      // Prefer agent_run/decision activities (they represent the LLM call)
      const actTime = new Date(activity.timestamp).getTime();
      const delta = Math.abs(actTime - genTimeMs);

      if (maxDeltaMs !== undefined && delta > maxDeltaMs) continue;

      // Prefer agent_run and decision types as they represent LLM invocations
      const typeBonus = (activity.actionType === 'decision' || activity.actionType === 'api_call') ? 0 : 1000;

      if (!best || (delta + typeBonus) < (best.delta)) {
        best = { id: activity.id, delta: delta + typeBonus };
      }
    }

    return best?.id ?? null;
  }

  /**
   * Extract session UUID from JSONL file path.
   * e.g. ...sessions/03052448-f4db-44f1-acfb-4f296cb75e8b.jsonl -> "03052448-f4db-44f1-acfb-4f296cb75e8b"
   * e.g. ...sessions/main.jsonl -> null (not a UUID-named file)
   */
  private extractSessionUuid(filePath: string): string | null {
    const filename = filePath.split('/').pop()?.replace('.jsonl', '') ?? '';
    // UUID pattern
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(filename)) {
      return filename;
    }
    return null;
  }

  /**
   * Update activities with aggregated costs from their linked generations.
   * For each activity with linked generations, sum up the generation costs.
   */
  private async updateActivityCosts(): Promise<{ activitiesUpdated: number; totalCostAttributed: number }> {
    // Get all linked generations grouped by activity
    const generations = await this.db.getGenerations({ limit: 10000 });
    const linkedByActivity = new Map<string, Generation[]>();

    for (const gen of generations) {
      if (!gen.linked_activity_id) continue;
      const existing = linkedByActivity.get(gen.linked_activity_id) || [];
      existing.push(gen);
      linkedByActivity.set(gen.linked_activity_id, existing);
    }

    let activitiesUpdated = 0;
    let totalCostAttributed = 0;

    for (const [activityId, gens] of linkedByActivity) {
      const totalCost = gens.reduce((sum: number, g: Generation) => sum + (g.cost_total || 0), 0);
      const totalInput = gens.reduce((sum: number, g: Generation) => sum + (g.input_tokens || 0), 0);
      const totalOutput = gens.reduce((sum: number, g: Generation) => sum + (g.output_tokens || 0), 0);
      const totalTokens = gens.reduce((sum: number, g: Generation) => sum + (g.total_tokens || 0), 0);
      const model = gens[0]?.model;

      if (totalCost > 0) {
        await this.db.updateActivity(activityId, {
          cost: { usd: totalCost },
          tokens: {
            inputTokens: totalInput,
            outputTokens: totalOutput,
            totalTokens,
            model,
          },
        });
        activitiesUpdated++;
        totalCostAttributed += totalCost;
      }
    }

    return { activitiesUpdated, totalCostAttributed };
  }
}
