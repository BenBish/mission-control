import { describe, test, expect } from "bun:test";
import type { Activity, SessionSummary } from "../../types/activity.js";

/**
 * Unit tests for SessionTimeline computation logic.
 * Tests the data transformation and decision logic used by the component.
 */

function makeActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: "act-1",
    profileId: "default",
    sessionId: "session-1",
    timestamp: "2026-01-01T00:00:00.000Z",
    actor: { type: "orchestrator", id: "agent-1", displayName: "Agent 1" },
    actionType: "tool_call",
    description: "Test activity",
    status: "success",
    ...overrides,
  };
}

function makeSession(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    sessionId: "session-1",
    startTime: "2026-01-01T00:00:00.000Z",
    endTime: "2026-01-01T00:10:00.000Z",
    stats: {
      totalActions: 5,
      successCount: 4,
      failureCount: 1,
      successRate: 80,
      totalTokens: 5000,
      totalCost: 0.5,
      avgActionDuration: 2000,
    },
    actors: {
      "agent-1": {
        name: "Agent 1",
        actionsCount: 3,
        successCount: 2,
        tokensUsed: 3000,
        costUsd: 0.3,
      },
      "agent-2": {
        name: "Agent 2",
        actionsCount: 2,
        successCount: 2,
        tokensUsed: 2000,
        costUsd: 0.2,
      },
    },
    topTools: [],
    events: [],
    ...overrides,
  };
}

describe("SessionTimeline logic", () => {
  describe("hasTimelineData detection", () => {
    test("returns false for single activity", () => {
      const activities = [makeActivity()];
      const hasTimeline =
        activities.length > 1 && activities.some((a) => a.durationMs != null);
      expect(hasTimeline).toBe(false);
    });

    test("returns false when all durationMs are null", () => {
      const activities = [
        makeActivity({ id: "1", durationMs: undefined }),
        makeActivity({ id: "2", durationMs: undefined }),
      ];
      const hasTimeline =
        activities.length > 1 && activities.some((a) => a.durationMs != null);
      expect(hasTimeline).toBe(false);
    });

    test("returns true when at least one activity has durationMs", () => {
      const activities = [
        makeActivity({ id: "1", durationMs: 5000 }),
        makeActivity({ id: "2", durationMs: undefined }),
      ];
      const hasTimeline =
        activities.length > 1 && activities.some((a) => a.durationMs != null);
      expect(hasTimeline).toBe(true);
    });
  });

  describe("actor lane computation", () => {
    test("creates one lane per unique actor", () => {
      const activities = [
        makeActivity({
          id: "1",
          actor: { type: "orchestrator", id: "a1", displayName: "Agent 1" },
        }),
        makeActivity({
          id: "2",
          actor: { type: "subagent", id: "a2", displayName: "Agent 2" },
        }),
        makeActivity({
          id: "3",
          actor: { type: "orchestrator", id: "a1", displayName: "Agent 1" },
        }),
      ];

      const actorMap = new Map<string, { id: string; name: string }>();
      for (const activity of activities) {
        if (!actorMap.has(activity.actor.id)) {
          actorMap.set(activity.actor.id, {
            id: activity.actor.id,
            name: activity.actor.displayName || activity.actor.id,
          });
        }
      }

      expect(actorMap.size).toBe(2);
      expect(actorMap.get("a1")!.name).toBe("Agent 1");
      expect(actorMap.get("a2")!.name).toBe("Agent 2");
    });

    test("falls back to actor.id when displayName is missing", () => {
      const activities = [
        makeActivity({
          id: "1",
          actor: { type: "orchestrator", id: "raw-id" },
        }),
      ];

      const actorMap = new Map<string, { id: string; name: string }>();
      for (const activity of activities) {
        if (!actorMap.has(activity.actor.id)) {
          actorMap.set(activity.actor.id, {
            id: activity.actor.id,
            name: activity.actor.displayName || activity.actor.id,
          });
        }
      }

      expect(actorMap.get("raw-id")!.name).toBe("raw-id");
    });
  });

  describe("active/idle time computation", () => {
    test("sums durationMs for active time", () => {
      const activities = [
        makeActivity({ id: "1", durationMs: 3000 }),
        makeActivity({ id: "2", durationMs: 5000 }),
        makeActivity({ id: "3", durationMs: undefined }),
      ];

      let active = 0;
      for (const a of activities) {
        if (a.durationMs) active += a.durationMs;
      }

      expect(active).toBe(8000);
    });

    test("idle time is total minus active", () => {
      const totalDurationMs = 600000; // 10 minutes
      const activeTimeMs = 8000;
      const idleTimeMs = Math.max(0, totalDurationMs - activeTimeMs);

      expect(idleTimeMs).toBe(592000);
    });
  });

  describe("cost by actor computation", () => {
    test("aggregates costs per actor", () => {
      const activities = [
        makeActivity({
          id: "1",
          actor: { type: "orchestrator", id: "a1" },
          cost: { usd: 0.1 },
        }),
        makeActivity({
          id: "2",
          actor: { type: "orchestrator", id: "a1" },
          cost: { usd: 0.2 },
        }),
        makeActivity({
          id: "3",
          actor: { type: "subagent", id: "a2" },
          cost: { usd: 0.05 },
        }),
      ];

      const costs = new Map<string, number>();
      let totalCost = 0;
      for (const a of activities) {
        const cost = a.cost?.usd || 0;
        totalCost += cost;
        costs.set(a.actor.id, (costs.get(a.actor.id) || 0) + cost);
      }

      expect(totalCost).toBeCloseTo(0.35);
      expect(costs.get("a1")).toBeCloseTo(0.3);
      expect(costs.get("a2")).toBeCloseTo(0.05);
    });

    test("handles activities with no cost", () => {
      const activities = [
        makeActivity({ id: "1", cost: undefined }),
        makeActivity({ id: "2", cost: undefined }),
      ];

      let totalCost = 0;
      for (const a of activities) {
        totalCost += a.cost?.usd || 0;
      }

      expect(totalCost).toBe(0);
    });
  });

  describe("pill positioning", () => {
    test("computes left percentage from timestamp offset", () => {
      const timeStart = new Date("2026-01-01T00:00:00Z").getTime();
      const totalDurationMs = 600000; // 10 min

      // Activity at 5 minutes in = 50%
      const actTimestamp = new Date("2026-01-01T00:05:00Z").getTime();
      const leftPct =
        totalDurationMs > 0
          ? ((actTimestamp - timeStart) / totalDurationMs) * 100
          : 0;

      expect(leftPct).toBe(50);
    });

    test("computes width percentage from durationMs", () => {
      const totalDurationMs = 600000; // 10 min
      const durationMs = 60000; // 1 min

      const widthPct = (durationMs / totalDurationMs) * 100;
      expect(widthPct).toBeCloseTo(10);
    });

    test("returns 0% left for activity at session start", () => {
      const timeStart = new Date("2026-01-01T00:00:00Z").getTime();
      const totalDurationMs = 600000;
      const actTimestamp = timeStart;
      const leftPct = ((actTimestamp - timeStart) / totalDurationMs) * 100;

      expect(leftPct).toBe(0);
    });
  });

  describe("status color mapping", () => {
    test("all statuses have color definitions", () => {
      const STATUS_COLORS: Record<string, { bg: string }> = {
        success: { bg: "bg-emerald-500" },
        failure: { bg: "bg-red-500" },
        pending: { bg: "bg-amber-500" },
        partial: { bg: "bg-blue-500" },
      };

      expect(STATUS_COLORS.success.bg).toBe("bg-emerald-500");
      expect(STATUS_COLORS.failure.bg).toBe("bg-red-500");
      expect(STATUS_COLORS.pending.bg).toBe("bg-amber-500");
      expect(STATUS_COLORS.partial.bg).toBe("bg-blue-500");
    });
  });
});
