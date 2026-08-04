import { describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import {
  cwdFromSessionPath,
  emptyAggregate,
  mergeSessionUpdate,
  normalizeGrokUsageTokens,
  parseGrokLine,
  readGrokSessionSnapshot,
  sessionExternalIdFromPath,
} from "../../../collectors/grok/parser.js";

function sessionFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-grok-parser-"));
  const cwd = "/home/ben/Dev/mission-control";
  const sessionId = "019f6879-489f-7350-811c-b045352c43d0";
  const dir = path.join(root, encodeURIComponent(cwd), sessionId);
  fs.mkdirSync(dir, { recursive: true });
  const updates = path.join(dir, "updates.jsonl");
  return { root, cwd, sessionId, dir, updates };
}

describe("Grok parser", () => {
  test("derives session id and cwd from Grok session paths", () => {
    const { root, cwd, sessionId, updates } = sessionFixture();
    try {
      expect(sessionExternalIdFromPath(updates)).toBe(sessionId);
      expect(cwdFromSessionPath(updates)).toBe(cwd);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("reads summary and signals as a session snapshot", () => {
    const { root, dir, updates } = sessionFixture();
    try {
      fs.writeFileSync(
        path.join(dir, "summary.json"),
        JSON.stringify({
          current_model_id: "grok-4.5",
          generated_title: "Investigate collector",
          created_at: 1784164225,
          updated_at: 1784166071,
          git_root_dir: "/home/ben/Dev/mission-control",
          head_branch: "main",
          agent_name: "Grok",
        }),
      );
      fs.writeFileSync(
        path.join(dir, "signals.json"),
        JSON.stringify({
          turnCount: 9,
          toolCallCount: 7,
          toolFailureCount: 1,
          inputTokens: 312746,
          outputTokens: 3014,
        }),
      );

      const snapshot = readGrokSessionSnapshot(updates);
      expect(snapshot.title).toBe("Investigate collector");
      expect(snapshot.model).toBe("grok-4.5");
      expect(snapshot.gitBranch).toBe("main");
      expect(snapshot.turnCount).toBe(9);
      expect(snapshot.toolCallCount).toBe(7);
      expect(snapshot.failureCount).toBe(1);
      expect(snapshot.inputTokens).toBe(312746);
      expect(snapshot.outputTokens).toBe(3014);
      expect(snapshot.startedAt).toBe("2026-07-16T01:10:25.000Z");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("parses tool lifecycle: Pending → enrichment → completed", () => {
    const { root, updates, sessionId } = sessionFixture();
    try {
      const pending = parseGrokLine(
        JSON.stringify({
          method: "session/update",
          timestamp: 1784164227,
          params: {
            sessionId,
            _meta: {
              eventId: "event-tool-pending",
              updateParams: {
                kind: "Other",
                status: "Pending",
                title: "read_file",
                toolCallId: "call-1",
              },
            },
            update: {
              sessionUpdate: "tool_call",
              toolCallId: "call-1",
              title: "read_file",
              rawInput: { target_file: "/tmp/a" },
              _meta: {
                modelId: "grok-4.5",
                "x.ai/tool": { name: "read_file", namespace: "builtin" },
              },
            },
          },
        }),
        updates,
      );

      expect(pending?.sessionExternalId).toBe(sessionId);
      expect(pending?.toolCallDelta).toBe(1);
      expect(pending?.activity?.kind).toBe("activity");
      expect(pending?.activity?.naturalKey).toBe(
        `${updates}:event-tool-pending`,
      );
      expect(pending?.activity?.payload).toMatchObject({
        actionType: "tool_call",
        actorId: "grok",
        status: "running",
        toolName: "read_file",
        externalId: "call-1",
      });
      expect(pending?.activity?.payload.completedAt).toBeUndefined();

      // Intermediate enrichment: status null must stay running, not success.
      const enrich = parseGrokLine(
        JSON.stringify({
          method: "session/update",
          timestamp: 1784164227.5,
          params: {
            sessionId,
            _meta: {
              eventId: "event-tool-enrich",
              updateParams: {
                toolCallId: "call-1",
                status: null,
              },
            },
            update: {
              sessionUpdate: "tool_call_update",
              toolCallId: "call-1",
              kind: "read",
              title: "Read `/tmp/a`",
              _meta: {
                "x.ai/tool": { name: "read_file", namespace: "builtin" },
              },
            },
          },
        }),
        updates,
      );
      expect(enrich?.activity?.payload).toMatchObject({
        status: "running",
        description: "Read `/tmp/a`",
        externalId: "call-1",
      });
      expect(enrich?.toolCallDelta).toBe(0);

      const completed = parseGrokLine(
        JSON.stringify({
          method: "session/update",
          timestamp: 1784164228,
          params: {
            sessionId,
            _meta: {
              eventId: "event-tool-done",
              updateParams: {
                toolCallId: "call-1",
                status: "Completed",
              },
            },
            update: {
              sessionUpdate: "tool_call_update",
              toolCallId: "call-1",
              status: "completed",
              rawOutput: { type: "ReadFile", content: "ok" },
            },
          },
        }),
        updates,
      );
      expect(completed?.activity?.payload).toMatchObject({
        status: "success",
        externalId: "call-1",
        completedAt: "2026-07-16T01:10:28.000Z",
      });
      expect(completed?.activity?.naturalKey).toBe(
        `${updates}:event-tool-done`,
      );
      expect(completed?.toolCallDelta).toBe(0);
      expect(completed?.failureDelta).toBe(0);

      const failed = parseGrokLine(
        JSON.stringify({
          method: "session/update",
          timestamp: 1784164229,
          params: {
            sessionId,
            _meta: {
              eventId: "event-tool-fail",
              updateParams: { toolCallId: "call-2", status: "Failed" },
            },
            update: {
              sessionUpdate: "tool_call_update",
              toolCallId: "call-2",
              status: "failed",
            },
          },
        }),
        updates,
      );
      expect(failed?.activity?.payload.status).toBe("failure");
      expect(failed?.failureDelta).toBe(1);

      // in_progress maps to running
      const inProgress = parseGrokLine(
        JSON.stringify({
          method: "session/update",
          timestamp: 1784164230,
          params: {
            sessionId,
            _meta: { eventId: "event-tool-ip" },
            update: {
              sessionUpdate: "tool_call_update",
              toolCallId: "call-3",
              status: "in_progress",
            },
          },
        }),
        updates,
      );
      expect(inProgress?.activity?.payload.status).toBe("running");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("parses cumulative usage updates", () => {
    const { root, updates, sessionId } = sessionFixture();
    try {
      const usage = parseGrokLine(
        JSON.stringify({
          method: "_x.ai/session/update",
          timestamp: 1784166071,
          params: {
            sessionId,
            _meta: { eventId: "event-usage" },
            update: {
              usage: {
                inputTokens: 1000,
                outputTokens: 50,
                totalTokens: 1050,
                cachedReadTokens: 800,
                reasoningTokens: 10,
                modelCalls: 2,
                numTurns: 3,
                modelUsage: {
                  "grok-4.5": {
                    inputTokens: 1000,
                    outputTokens: 50,
                    totalTokens: 1050,
                  },
                },
              },
            },
          },
        }),
        updates,
      );

      // Grok reports cache-inclusive input (1000) with 800 cache reads;
      // parser stores Claude-style non-cached input (200).
      // usage.numTurns must not overwrite session turnCount.
      expect(usage?.sessionUpdate).toMatchObject({
        model: "grok-4.5",
        inputTokens: 200,
        outputTokens: 50,
        cacheReadTokens: 800,
      });
      expect(usage?.sessionUpdate?.turnCount).toBeUndefined();
      expect(usage?.activity?.payload).toMatchObject({
        actorType: "system",
        actorId: "grok-usage",
        model: "grok-4.5",
        inputTokens: 200,
        outputTokens: 50,
        cacheReadTokens: 800,
        totalTokens: 1050,
        details: { rawInputTokens: 1000, numTurns: 3 },
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("normalizeGrokUsageTokens subtracts cache from inclusive input", () => {
    expect(
      normalizeGrokUsageTokens({
        inputTokens: 2234690,
        outputTokens: 26504,
        totalTokens: 2261194,
        cachedReadTokens: 2155264,
      }),
    ).toEqual({
      inputTokens: 79426,
      outputTokens: 26504,
      cacheReadTokens: 2155264,
      totalTokens: 2261194,
    });

    // total falls back to rawInput + output so exclusive rows keep
    // total ≈ input + cache + output (not input + output alone).
    expect(
      normalizeGrokUsageTokens({
        inputTokens: 100,
        outputTokens: 10,
        cachedReadTokens: 0,
      }),
    ).toEqual({
      inputTokens: 100,
      outputTokens: 10,
      cacheReadTokens: 0,
      totalTokens: 110,
    });

    expect(
      normalizeGrokUsageTokens({
        inputTokens: 1000,
        outputTokens: 50,
        cachedReadTokens: 800,
      }),
    ).toEqual({
      inputTokens: 200,
      outputTokens: 50,
      cacheReadTokens: 800,
      totalTokens: 1050,
    });

    // Never go negative if counters are inconsistent.
    expect(
      normalizeGrokUsageTokens({
        inputTokens: 50,
        cachedReadTokens: 80,
      }),
    ).toMatchObject({ inputTokens: 0, cacheReadTokens: 80 });
  });

  test("mergeSessionUpdate preserves cumulative counters from latest updates", () => {
    let agg = emptyAggregate("sess-1");
    agg = mergeSessionUpdate(agg, {
      turnCount: 1,
      toolCallCount: 4,
      inputTokens: 100,
    });
    agg = mergeSessionUpdate(agg, {
      turnCount: 3,
      toolCallCount: 2,
      inputTokens: 250,
    });

    expect(agg.turnCount).toBe(3);
    expect(agg.toolCallCount).toBe(4);
    expect(agg.inputTokens).toBe(250);
  });
});
