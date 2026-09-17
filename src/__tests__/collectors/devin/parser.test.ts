import { describe, expect, test } from "bun:test";
import {
  advanceSessionCursor,
  emptyCursor,
  isAfterSessionCursor,
  normalizeCursor,
  parseMessageNode,
  parseSessionMetadata,
  sessionRowToPayload,
  sessionToIngestEvent,
  toIso,
  toolNameFromCallId,
  type DevinMessageNodeRow,
  type DevinSessionRow,
} from "../../../collectors/devin/parser.js";

const baseSession: DevinSessionRow = {
  id: "amenable-trip",
  working_directory: "/home/ben/Dev/mission-control",
  backend_type: "windsurf",
  model: "swe-2-high",
  agent_mode: "normal",
  created_at: 1_789_622_570,
  last_activity_at: 1_789_622_881,
  title: "Goal complete BSH-422",
  hidden: 0,
  metadata: null,
};

function nodeRow(
  rowId: number,
  msg: Record<string, unknown>,
): DevinMessageNodeRow {
  return {
    row_id: rowId,
    session_id: baseSession.id,
    node_id: rowId,
    parent_node_id: null,
    chat_message: JSON.stringify(msg),
    created_at: 1_789_622_600,
  };
}

describe("toIso", () => {
  test("converts epoch seconds to ISO", () => {
    expect(toIso(1_789_622_570)).toBe(
      new Date(1_789_622_570 * 1000).toISOString(),
    );
  });

  test("returns undefined for missing/nonpositive", () => {
    expect(toIso(null)).toBeUndefined();
    expect(toIso(0)).toBeUndefined();
    expect(toIso(-5)).toBeUndefined();
  });
});

describe("cursor helpers", () => {
  test("emptyCursor starts at zero", () => {
    const c = emptyCursor();
    expect(c.session).toEqual({ activity: 0, id: "" });
    expect(c.messageRowId).toBe(0);
  });

  test("isAfterSessionCursor respects (activity, id) ordering", () => {
    const c = { activity: 100, id: "b" };
    expect(isAfterSessionCursor(101, "a", c)).toBe(true);
    expect(isAfterSessionCursor(99, "z", c)).toBe(false);
    expect(isAfterSessionCursor(100, "c", c)).toBe(true);
    expect(isAfterSessionCursor(100, "a", c)).toBe(false);
  });

  test("advanceSessionCursor only moves forward", () => {
    const c = { activity: 100, id: "b" };
    expect(advanceSessionCursor(c, 50, "z")).toEqual(c);
    expect(advanceSessionCursor(c, 100, "c")).toEqual({
      activity: 100,
      id: "c",
    });
  });

  test("normalizeCursor tolerates junk", () => {
    expect(normalizeCursor(null)).toEqual(emptyCursor());
    expect(normalizeCursor("nope")).toEqual(emptyCursor());
    expect(
      normalizeCursor({ session: { activity: 5, id: "x" }, messageRowId: 9 }),
    ).toEqual({ session: { activity: 5, id: "x" }, messageRowId: 9 });
  });
});

describe("parseSessionMetadata", () => {
  test("extracts positive ACU/credit costs", () => {
    expect(
      parseSessionMetadata(
        JSON.stringify({ total_acu_cost: 1.5, total_credit_cost: 2 }),
      ),
    ).toEqual({ totalAcuCost: 1.5, totalCreditCost: 2 });
  });

  test("drops zero/negative/garbage", () => {
    expect(parseSessionMetadata(JSON.stringify({ total_acu_cost: 0 }))).toEqual(
      {},
    );
    expect(parseSessionMetadata(null)).toEqual({});
    expect(parseSessionMetadata("not json")).toEqual({});
  });
});

describe("sessionRowToPayload", () => {
  test("maps row + counts to SessionPayload without token/cost fabrication", () => {
    const payload = sessionRowToPayload(baseSession, {
      turnCount: 3,
      toolCallCount: 12,
      failureCount: 1,
    });
    expect(payload.externalId).toBe("amenable-trip");
    expect(payload.cwd).toBe("/home/ben/Dev/mission-control");
    expect(payload.title).toBe("Goal complete BSH-422");
    expect(payload.modelProvider).toBe("devin");
    expect(payload.startedAt).toBe(toIso(1_789_622_570));
    expect(payload.endedAt).toBe(toIso(1_789_622_881));
    expect(payload.turnCount).toBe(3);
    expect(payload.toolCallCount).toBe(12);
    expect(payload.failureCount).toBe(1);
    // Devin does not expose tokens; ACU is not USD — never fabricate.
    expect(payload.inputTokens).toBeUndefined();
    expect(payload.outputTokens).toBeUndefined();
    expect(payload.costUsd).toBeUndefined();
  });

  test("session event has a stable natural key", () => {
    const event = sessionToIngestEvent(baseSession, {
      turnCount: 1,
      toolCallCount: 2,
      failureCount: 0,
    });
    expect(event.kind).toBe("session");
    expect(event.naturalKey).toContain("amenable-trip@");
  });
});

describe("toolNameFromCallId", () => {
  test("extracts the tool prefix", () => {
    expect(toolNameFromCallId("exec_16#abc")).toBe("exec");
    expect(toolNameFromCallId("skill_1#def")).toBe("skill");
    expect(toolNameFromCallId("mcp_call_tool_0#x")).toBe("mcp");
    expect(toolNameFromCallId("nohash")).toBeUndefined();
    expect(toolNameFromCallId("")).toBeUndefined();
  });
});

describe("parseMessageNode", () => {
  test("user node → user_request activity", () => {
    const event = parseMessageNode(
      nodeRow(10, {
        message_id: "m-user",
        role: "user",
        content: "record devin usage please",
      }),
    );
    expect(event?.kind).toBe("activity");
    const p = event?.payload as Record<string, unknown>;
    expect(p?.actionType).toBe("user_request");
    expect(p?.actorType).toBe("user");
    expect(p?.description).toBe("record devin usage please");
    expect(p?.sessionExternalId).toBe("amenable-trip");
  });

  test("assistant node → message activity with tool call names", () => {
    const event = parseMessageNode(
      nodeRow(11, {
        message_id: "m-asst",
        role: "assistant",
        content: "On it.",
        tool_calls: [
          { id: "exec_1#h", name: "exec", index: 0 },
          { id: "read_2#h", name: "read", index: 1 },
        ],
      }),
    );
    const p = event?.payload as Record<string, unknown>;
    expect(p?.actionType).toBe("message");
    expect(p?.actorId).toBe("devin");
    const details = p?.details as Record<string, unknown>;
    expect(details?.toolNames).toEqual(["exec", "read"]);
  });

  test("tool node → tool_call activity with timing + success", () => {
    const event = parseMessageNode(
      nodeRow(12, {
        message_id: "m-tool",
        role: "tool",
        content: "file contents…",
        tool_call_id: "exec_16#43a68",
        metadata: {
          extensions: {
            "chisel/tool_call_timing": {
              started_at: "2026-09-16T19:14:12.860Z",
              finished_at: "2026-09-16T19:14:13.060Z",
              duration_ms: 200,
            },
            "chisel/tool_result_meta": { success: true, kind: "other" },
          },
        },
      }),
    );
    const p = event?.payload as Record<string, unknown>;
    expect(p?.actionType).toBe("tool_call");
    expect(p?.toolName).toBe("exec");
    expect(p?.externalId).toBe("exec_16#43a68");
    expect(p?.status).toBe("success");
    expect(p?.durationMs).toBe(200);
    expect(p?.timestamp).toBe("2026-09-16T19:14:12.860Z");
    expect(p?.completedAt).toBe("2026-09-16T19:14:13.060Z");
  });

  test("failed tool node → failure status", () => {
    const event = parseMessageNode(
      nodeRow(13, {
        message_id: "m-tool-fail",
        role: "tool",
        content: "exit code 1",
        tool_call_id: "exec_9#bad",
        metadata: {
          extensions: {
            "chisel/tool_result_meta": { success: false },
          },
        },
      }),
    );
    expect((event?.payload as Record<string, unknown>)?.status).toBe("failure");
    expect(event?.naturalKey).toContain(":failure");
  });

  test("system nodes are skipped", () => {
    expect(
      parseMessageNode(nodeRow(14, { role: "system", content: "<rules/>" })),
    ).toBeNull();
  });

  test("unparseable chat_message returns null", () => {
    const row = nodeRow(15, {});
    row.chat_message = "{invalid";
    expect(parseMessageNode(row)).toBeNull();
  });
});
