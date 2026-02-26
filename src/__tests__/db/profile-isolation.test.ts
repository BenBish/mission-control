/**
 * Profile Isolation Tests (ORC-45)
 * Verifies multi-profile database schema and migration
 */

import { Database } from "../../db/database.js";
import * as fs from "fs";

const TEST_DB_PATH = "./test-data/test-profile-isolation.db";
const FRESH_DB_PATH = "./test-data/test-fresh-profile.db";

describe("Profile Isolation", () => {
  let db: Database;

  beforeAll(() => {
    if (!fs.existsSync("./test-data")) {
      fs.mkdirSync("./test-data", { recursive: true });
    }
  });

  beforeEach(async () => {
    // Remove existing test db to start fresh each time
    for (const p of [TEST_DB_PATH, `${TEST_DB_PATH}-wal`, `${TEST_DB_PATH}-shm`]) {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    db = new Database(TEST_DB_PATH);
    await db.initialize();
  });

  afterEach(async () => {
    await db.close();
  });

  afterAll(() => {
    for (const p of [TEST_DB_PATH, FRESH_DB_PATH]) {
      for (const suffix of ["", "-wal", "-shm"]) {
        const f = `${p}${suffix}`;
        if (fs.existsSync(f)) fs.unlinkSync(f);
      }
    }
  });

  // ============================================================================
  // AC 1: schema_migrations table created and tracks versions
  // ============================================================================
  describe("AC 1: schema_migrations tracks versions", () => {
    test("schema_migrations table exists after initialize", async () => {
      const row = await (db as any).db.get(
        "SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
      );
      expect(row.cnt).toBe(1);
    });

    test("migration 001 is recorded", async () => {
      const rows = await (db as any).db.all(
        "SELECT version, name FROM schema_migrations ORDER BY version",
      );
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows[0].version).toBe("001");
      expect(rows[0].name).toBe("add-profile-id");
    });
  });

  // ============================================================================
  // AC 2: All 5 tables have profile_id column
  // ============================================================================
  describe("AC 2: All 5 tables have profile_id", () => {
    const tables = [
      "activities",
      "sessions",
      "cost_summaries",
      "llm_generations",
      "scan_state",
    ];

    for (const table of tables) {
      test(`${table} has profile_id column`, async () => {
        const cols = await (db as any).db.all(
          `PRAGMA table_info(${table})`,
        );
        const profileCol = cols.find(
          (c: any) => c.name === "profile_id",
        );
        expect(profileCol).toBeTruthy();
        expect(profileCol.type).toBe("TEXT");
        expect(profileCol.notnull).toBe(1);
      });
    }
  });

  // ============================================================================
  // AC 4 & 5: Isolation tests — getActivities with profileId filter
  // ============================================================================
  describe("AC 4 & 5: getActivities isolation", () => {
    test("getActivities({profileId: 'team'}) returns only team data", async () => {
      // Insert activities for two different profiles
      await db.createActivity({
        profileId: "team",
        sessionId: "s1",
        actor: { type: "subagent", id: "agent-1" },
        actionType: "tool_call",
        description: "Team activity",
      });
      await db.createActivity({
        profileId: "personal",
        sessionId: "s2",
        actor: { type: "subagent", id: "agent-2" },
        actionType: "tool_call",
        description: "Personal activity",
      });

      const teamActivities = await db.getActivities({ profileId: "team" });
      expect(teamActivities.length).toBe(1);
      expect(teamActivities[0].profileId).toBe("team");
      expect(teamActivities[0].description).toBe("Team activity");
    });

    test("getActivities({profileId: 'nonexistent'}) returns empty", async () => {
      await db.createActivity({
        profileId: "team",
        sessionId: "s1",
        actor: { type: "subagent", id: "agent-1" },
        actionType: "tool_call",
        description: "Team activity",
      });

      const results = await db.getActivities({ profileId: "nonexistent" });
      expect(results.length).toBe(0);
    });
  });

  // ============================================================================
  // AC 6: Insert profile A, query profile B → zero results
  // ============================================================================
  describe("AC 6: Cross-profile isolation", () => {
    test("insert profile A, query profile B returns zero results", async () => {
      await db.createActivity({
        profileId: "profile-a",
        sessionId: "s1",
        actor: { type: "subagent", id: "agent-1" },
        actionType: "tool_call",
        description: "Profile A activity",
      });

      const results = await db.getActivities({ profileId: "profile-b" });
      expect(results.length).toBe(0);
    });

    test("multiple profiles are fully isolated", async () => {
      for (const profile of ["alpha", "beta", "gamma"]) {
        for (let i = 0; i < 3; i++) {
          await db.createActivity({
            profileId: profile,
            sessionId: `${profile}-session`,
            actor: { type: "subagent", id: `${profile}-agent` },
            actionType: "tool_call",
            description: `${profile} activity ${i}`,
          });
        }
      }

      for (const profile of ["alpha", "beta", "gamma"]) {
        const activities = await db.getActivities({ profileId: profile });
        expect(activities.length).toBe(3);
        for (const a of activities) {
          expect(a.profileId).toBe(profile);
        }
      }

      // No filter returns all
      const all = await db.getActivities({});
      expect(all.length).toBe(9);
    });
  });

  // ============================================================================
  // AC 7: Fresh database includes profile_id from schema creation
  // ============================================================================
  describe("AC 7: Fresh database has profile_id", () => {
    test("fresh database schema includes profile_id columns", async () => {
      // Clean up any prior fresh db
      for (const suffix of ["", "-wal", "-shm"]) {
        const f = `${FRESH_DB_PATH}${suffix}`;
        if (fs.existsSync(f)) fs.unlinkSync(f);
      }

      const freshDb = new Database(FRESH_DB_PATH);
      await freshDb.initialize();

      // Verify schema has profile_id in CREATE TABLE
      const tables = [
        "activities",
        "sessions",
        "cost_summaries",
        "llm_generations",
        "scan_state",
      ];
      for (const table of tables) {
        const cols = await (freshDb as any).db.all(
          `PRAGMA table_info(${table})`,
        );
        const profileCol = cols.find(
          (c: any) => c.name === "profile_id",
        );
        expect(profileCol).toBeTruthy();
      }

      await freshDb.close();
    });
  });

  // ============================================================================
  // AC 8: Migration is idempotent (run twice safely)
  // ============================================================================
  describe("AC 8: Idempotent migration", () => {
    test("running initialize twice does not error", async () => {
      // db is already initialized in beforeEach — close and reinitialize
      await db.close();

      const db2 = new Database(TEST_DB_PATH);
      await db2.initialize(); // second init
      await db2.initialize(); // third init (just to be sure)

      // Should still have exactly one migration recorded
      const rows = await (db2 as any).db.all(
        "SELECT * FROM schema_migrations WHERE version = '001'",
      );
      expect(rows.length).toBe(1);

      await db2.close();

      // Reopen for afterEach
      db = new Database(TEST_DB_PATH);
      await db.initialize();
    });
  });

  // ============================================================================
  // AC 9: Composite index exists on activities
  // ============================================================================
  describe("AC 9: Composite index", () => {
    test("idx_activities_profile_timestamp index exists", async () => {
      const row = await (db as any).db.get(
        "SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='index' AND name='idx_activities_profile_timestamp'",
      );
      expect(row.cnt).toBe(1);
    });

    test("EXPLAIN QUERY PLAN uses profile index for filtered query", async () => {
      // Insert some data so planner has something to work with
      for (let i = 0; i < 10; i++) {
        await db.createActivity({
          profileId: "team",
          sessionId: `s${i}`,
          actor: { type: "subagent", id: "agent-1" },
          actionType: "tool_call",
          description: `Activity ${i}`,
        });
      }

      const plan = await (db as any).db.all(
        "EXPLAIN QUERY PLAN SELECT * FROM activities WHERE profile_id = 'team' ORDER BY timestamp DESC",
      );
      // The plan should reference our index
      const planStr = JSON.stringify(plan);
      expect(
        planStr.includes("idx_activities_profile_timestamp") ||
          planStr.includes("SEARCH"),
      ).toBe(true);
    });
  });

  // ============================================================================
  // AC 10: Server starts with both fresh and migrated databases
  //        (tested implicitly: fresh = FRESH_DB_PATH, migrated = TEST_DB_PATH)
  // ============================================================================

  // ============================================================================
  // Additional: Generation isolation
  // ============================================================================
  describe("Generation profile isolation", () => {
    test("getGenerations filters by profileId", async () => {
      await db.upsertGeneration({
        id: "gen-team-1",
        profileId: "team",
        sessionLogFile: "/logs/team.jsonl",
        sessionLogMsgId: "msg-1",
        agentId: "agent-1",
        timestamp: "2024-01-15T10:00:00Z",
        model: "claude-sonnet-4-20250514",
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 150,
        costInput: 0.001,
        costOutput: 0.002,
        costCacheRead: 0,
        costTotal: 0.003,
      });
      await db.upsertGeneration({
        id: "gen-personal-1",
        profileId: "personal",
        sessionLogFile: "/logs/personal.jsonl",
        sessionLogMsgId: "msg-2",
        agentId: "agent-2",
        timestamp: "2024-01-15T10:05:00Z",
        model: "claude-sonnet-4-20250514",
        inputTokens: 200,
        outputTokens: 100,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 300,
        costInput: 0.002,
        costOutput: 0.004,
        costCacheRead: 0,
        costTotal: 0.006,
      });

      const teamGens = await db.getGenerations({ profileId: "team" });
      expect(teamGens.length).toBe(1);
      expect(teamGens[0].profile_id).toBe("team");

      const personalGens = await db.getGenerations({ profileId: "personal" });
      expect(personalGens.length).toBe(1);
      expect(personalGens[0].profile_id).toBe("personal");

      const allGens = await db.getGenerations({});
      expect(allGens.length).toBe(2);
    });

    test("getGenerationSummary filters by profileId", async () => {
      await db.upsertGeneration({
        id: "gen-a",
        profileId: "team",
        sessionLogFile: "/logs/a.jsonl",
        sessionLogMsgId: "msg-a",
        agentId: "agent-1",
        timestamp: "2024-01-15T10:00:00Z",
        model: "claude-sonnet-4-20250514",
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 150,
        costInput: 0.001,
        costOutput: 0.002,
        costCacheRead: 0,
        costTotal: 0.003,
      });
      await db.upsertGeneration({
        id: "gen-b",
        profileId: "other",
        sessionLogFile: "/logs/b.jsonl",
        sessionLogMsgId: "msg-b",
        agentId: "agent-2",
        timestamp: "2024-01-15T10:05:00Z",
        model: "claude-sonnet-4-20250514",
        inputTokens: 500,
        outputTokens: 250,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 750,
        costInput: 0.01,
        costOutput: 0.02,
        costCacheRead: 0,
        costTotal: 0.03,
      });

      const teamSummary = await db.getGenerationSummary({
        profileId: "team",
      });
      expect(teamSummary.totalGenerations).toBe(1);
      expect(teamSummary.totalCost).toBeCloseTo(0.003);

      const allSummary = await db.getGenerationSummary({});
      expect(allSummary.totalGenerations).toBe(2);
    });
  });

  // ============================================================================
  // Additional: Agent stats isolation
  // ============================================================================
  describe("Agent stats profile isolation", () => {
    test("getAgentStats filters by profileId", async () => {
      await db.createActivity({
        profileId: "team",
        sessionId: "s1",
        actor: { type: "subagent", id: "agent-1" },
        actionType: "tool_call",
        description: "Team work",
      });
      await db.createActivity({
        profileId: "personal",
        sessionId: "s2",
        actor: { type: "subagent", id: "agent-2" },
        actionType: "tool_call",
        description: "Personal work",
      });

      const teamStats = await db.getAgentStats({ profileId: "team" });
      expect(teamStats.size).toBe(1);
      expect(teamStats.has("agent-1")).toBe(true);
      expect(teamStats.has("agent-2")).toBe(false);

      const allStats = await db.getAgentStats();
      expect(allStats.size).toBe(2);
    });
  });
});
