import { describe, test, expect } from "bun:test";
import { parseActors } from "../../lib/parse-actors.js";

describe("parseActors", () => {
  test("returns [] for null input", () => {
    expect(parseActors(null)).toEqual([]);
  });

  test("returns [] for empty string", () => {
    expect(parseActors("")).toEqual([]);
  });

  test("returns array as-is when JSON is an array", () => {
    const actors = [
      { id: "main", type: "orchestrator" },
      { id: "worker-1", type: "worker", displayName: "Writer", emoji: "✍️" },
    ];
    expect(parseActors(JSON.stringify(actors))).toEqual(actors);
  });

  test("converts object/record to array via Object.values()", () => {
    const record = {
      main: {
        id: "main",
        type: "orchestrator",
        actionsCount: 0,
        successCount: 0,
        tokensUsed: 0,
        costUsd: 0,
      },
      "worker-1": {
        id: "worker-1",
        type: "worker",
        displayName: "Writer",
        emoji: "✍️",
      },
    };
    const result = parseActors(JSON.stringify(record));
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(record.main);
    expect(result[1]).toEqual(record["worker-1"]);
  });

  test("returns [] for invalid JSON", () => {
    expect(parseActors("{not valid json")).toEqual([]);
  });

  test("returns [] for non-object/non-array JSON (e.g. number)", () => {
    expect(parseActors("42")).toEqual([]);
  });

  test("returns [] for JSON null", () => {
    expect(parseActors("null")).toEqual([]);
  });
});
