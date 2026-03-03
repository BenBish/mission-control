/**
 * SSE Profile Scoping Tests
 * Verifies that Server-Sent Events are properly scoped to profiles:
 * - AC1: /api/stream?profile=team only receives events for profile "team"
 * - AC2: /api/stream?profile=default only receives events for profile "default"
 * - AC5: No cross-profile event leakage
 * - AC6: System event with { type: 'connected', profile: '<id>' } on connect
 * - AC9: Multiple simultaneous connections across profiles
 * - AC10: Backward compatibility — no ?profile defaults to "default"
 */

import {
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "bun:test";
import express from "express";
import { Database } from "../../db/database.js";
import { ActivityLogger } from "../../logger/activity-logger.js";
import { setupRoutes } from "../../api/routes.js";
import { profileContextMiddleware } from "../../api/middleware/profile-context.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

let server: ReturnType<typeof app.listen>;
let app: ReturnType<typeof express>;
let baseUrl: string;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sse-profile-test-"));
  const dbPath = path.join(tmpDir, "test.db");

  app = express();
  app.use(express.json());
  app.use(profileContextMiddleware);

  const db = new Database(dbPath);
  await db.initialize();
  const logger = new ActivityLogger(db);

  // Mock CronService for route setup — save originals and restore in afterAll
  const { CronService } = await import("../../services/cron-service.js");
  const origGetJobs = CronService.getJobs;
  const origGetJob = CronService.getJob;
  const origGetRunHistory = CronService.getRunHistory;
  (CronService as any)._origGetJobs = origGetJobs;
  (CronService as any)._origGetJob = origGetJob;
  (CronService as any)._origGetRunHistory = origGetRunHistory;
  (CronService as any).getJobs = async () => [];
  (CronService as any).getJob = async () => null;
  (CronService as any).getRunHistory = async () => [];

  setupRoutes(app, logger);

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address();
      if (typeof addr === "object" && addr) {
        baseUrl = `http://127.0.0.1:${addr.port}`;
      }
      resolve();
    });
  });
});

afterAll(async () => {
  // Restore CronService mocks to avoid contaminating other test files
  try {
    const { CronService } = await import("../../services/cron-service.js");
    if ((CronService as any)._origGetJobs) {
      (CronService as any).getJobs = (CronService as any)._origGetJobs;
      (CronService as any).getJob = (CronService as any)._origGetJob;
      (CronService as any).getRunHistory = (
        CronService as any
      )._origGetRunHistory;
      delete (CronService as any)._origGetJobs;
      delete (CronService as any)._origGetJob;
      delete (CronService as any)._origGetRunHistory;
    }
  } catch {
    // Best effort
  }

  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function post(path: string, body: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

/** Collect SSE events from a stream for a given duration */
async function collectSSEEvents(
  profileParam: string | null,
  durationMs: number,
): Promise<{
  events: Array<{ event: string; data: string }>;
  abort: AbortController;
}> {
  const abort = new AbortController();
  const url = profileParam
    ? `${baseUrl}/api/stream?profile=${profileParam}`
    : `${baseUrl}/api/stream`;

  const res = await fetch(url, { signal: abort.signal });
  expect(res.status).toBe(200);

  const events: Array<{ event: string; data: string }> = [];
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const readPromise = (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Parse SSE frames
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";

        for (const part of parts) {
          if (!part.trim()) continue;
          let eventType = "message";
          let data = "";
          for (const line of part.split("\n")) {
            if (line.startsWith("event: ")) {
              eventType = line.slice(7);
            } else if (line.startsWith("data: ")) {
              data = line.slice(6);
            }
          }
          if (data) {
            events.push({ event: eventType, data });
          }
        }
      }
    } catch {
      // AbortError expected when we close
    }
  })();

  // Wait for the specified duration, then abort
  await new Promise((r) => setTimeout(r, durationMs));
  abort.abort();
  await readPromise.catch(() => {});

  return { events, abort };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SSE Profile Scoping", () => {
  test("AC6: should send system connected event with profile on initial connect", async () => {
    const { events } = await collectSSEEvents("team", 100);

    const systemEvents = events.filter((e) => e.event === "system");
    expect(systemEvents.length).toBeGreaterThanOrEqual(1);

    const connectedEvent = JSON.parse(systemEvents[0].data);
    expect(connectedEvent.type).toBe("connected");
    expect(connectedEvent.profile).toBe("team");
  });

  test("AC10: should default to 'default' profile when no ?profile param", async () => {
    const { events } = await collectSSEEvents(null, 100);

    const systemEvents = events.filter((e) => e.event === "system");
    expect(systemEvents.length).toBeGreaterThanOrEqual(1);

    const connectedEvent = JSON.parse(systemEvents[0].data);
    expect(connectedEvent.type).toBe("connected");
    expect(connectedEvent.profile).toBe("default");
  });

  test("AC1+AC2+AC5: profile-scoped broadcast — no cross-profile leakage", async () => {
    // Connect two SSE clients to different profiles and accumulate events
    const abortTeam = new AbortController();
    const abortDefault = new AbortController();
    const teamActivityEvents: string[] = [];
    const defaultActivityEvents: string[] = [];

    // Helper to start reading SSE stream and collecting activity events
    const startCollecting = (
      profile: string,
      abort: AbortController,
      events: string[],
    ) => {
      return (async () => {
        const res = await fetch(`${baseUrl}/api/stream?profile=${profile}`, {
          signal: abort.signal,
        });
        expect(res.status).toBe(200);

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            const parts = buffer.split("\n\n");
            buffer = parts.pop() || "";

            for (const part of parts) {
              if (part.includes("event: activity")) {
                events.push(part);
              }
            }
          }
        } catch {
          // AbortError expected
        }
      })();
    };

    const teamPromise = startCollecting("team", abortTeam, teamActivityEvents);
    const defaultPromise = startCollecting(
      "default",
      abortDefault,
      defaultActivityEvents,
    );

    // Give connections time to register
    await new Promise((r) => setTimeout(r, 100));

    // Create activity for profile "team"
    const { status } = await post("/api/activities", {
      activities: [
        {
          type: "tool_execution",
          sessionId: "sse-team-test",
          agentId: "engineer",
          toolName: "exec",
          profileId: "team",
          timestamp: new Date().toISOString(),
        },
      ],
    });
    expect(status).toBe(200);

    // Wait for events to propagate
    await new Promise((r) => setTimeout(r, 200));

    // Close both connections
    abortTeam.abort();
    abortDefault.abort();
    await Promise.allSettled([teamPromise, defaultPromise]);

    // Team client should have received the activity event
    expect(teamActivityEvents.length).toBeGreaterThanOrEqual(1);

    // Default client should NOT have received any activity events
    expect(defaultActivityEvents.length).toBe(0);
  });

  test("AC9: should handle 10+ simultaneous SSE connections across profiles", async () => {
    const controllers: AbortController[] = [];
    const profiles = [
      "alpha",
      "beta",
      "gamma",
      "delta",
      "epsilon",
      "alpha",
      "beta",
      "gamma",
      "delta",
      "epsilon",
      "zeta",
      "eta",
    ];

    try {
      // Open 12 simultaneous connections
      const connections = await Promise.all(
        profiles.map(async (profile) => {
          const controller = new AbortController();
          controllers.push(controller);
          const res = await fetch(`${baseUrl}/api/stream?profile=${profile}`, {
            signal: controller.signal,
          });
          expect(res.status).toBe(200);
          return res;
        }),
      );

      // All should be connected
      expect(connections.length).toBe(12);

      // Give connections time to register
      await new Promise((r) => setTimeout(r, 50));

      // Create activity for "alpha" profile — should reach 2 of the 12 clients
      const { status } = await post("/api/activities", {
        activities: [
          {
            type: "tool_execution",
            sessionId: "sse-multi-test",
            agentId: "engineer",
            toolName: "exec",
            profileId: "alpha",
            timestamp: new Date().toISOString(),
          },
        ],
      });
      expect(status).toBe(200);
    } finally {
      // Clean up all connections
      for (const controller of controllers) {
        controller.abort();
      }
    }
  });

  test("should include correct SSE headers", async () => {
    const controller = new AbortController();
    const res = await fetch(`${baseUrl}/api/stream?profile=test`, {
      signal: controller.signal,
    });

    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("cache-control")).toBe("no-cache");

    controller.abort();
  });
});
