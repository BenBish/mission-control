import { describe, expect, test } from "bun:test";
import {
  classifyPlanWindow,
  fillCanonicalPlanSlots,
  UNAVAILABLE_SLOT_LABEL,
} from "../../lib/plan-windows.js";

describe("classifyPlanWindow", () => {
  test("maps Claude 5h / weekly / Opus extra", () => {
    expect(
      classifyPlanWindow({ limitId: "claude:5h", windowMinutes: 300 }).kind,
    ).toBe("5h");
    expect(
      classifyPlanWindow({ limitId: "claude:7d", windowMinutes: 10080 }).kind,
    ).toBe("wk");
    const opus = classifyPlanWindow({
      limitId: "claude:7d_opus",
      windowMinutes: 10080,
    });
    expect(opus.kind).toBe("extra");
    expect(opus.key).toBe("opus_wk");
  });

  test("maps Codex primary/secondary by minutes, not name alone", () => {
    expect(
      classifyPlanWindow({
        limitId: "codex:primary",
        windowMinutes: 300,
      }).kind,
    ).toBe("5h");
    expect(
      classifyPlanWindow({
        limitId: "codex:secondary",
        windowMinutes: 10080,
      }).kind,
    ).toBe("wk");
    expect(
      classifyPlanWindow({
        limitId: "codex:primary",
        windowMinutes: 10080,
      }).kind,
    ).toBe("wk");
  });

  test("maps Grok week / 5h / month / product extras", () => {
    expect(classifyPlanWindow({ limitId: "grok:week" }).kind).toBe("wk");
    expect(classifyPlanWindow({ limitId: "grok:5h" }).kind).toBe("5h");
    expect(classifyPlanWindow({ limitId: "grok:month" })).toMatchObject({
      kind: "extra",
      key: "month",
    });
    expect(classifyPlanWindow({ limitId: "grok:imagine" })).toMatchObject({
      kind: "extra",
      key: "imagine",
    });
    expect(
      classifyPlanWindow({ periodType: "USAGE_PERIOD_TYPE_WEEKLY" }).kind,
    ).toBe("wk");
  });
});

describe("fillCanonicalPlanSlots", () => {
  test("adds unavailable 5h when only weekly exists", () => {
    const filled = fillCanonicalPlanSlots(
      [{ label: "quota_grok:week_10080m", limitId: "grok:week" }],
      {
        classify: (row) =>
          classifyPlanWindow({ limitId: row.limitId, label: row.label }),
        buildUnavailable: (slot) => ({
          label: UNAVAILABLE_SLOT_LABEL[slot],
          limitId: slot,
        }),
      },
    );
    expect(filled).toHaveLength(2);
    expect(filled.some((r) => r.label === "quota_slot:5h")).toBe(true);
    expect(filled.some((r) => r.label === "quota_grok:week_10080m")).toBe(true);
  });

  test("does not replace an expired primary with unavailable", () => {
    const filled = fillCanonicalPlanSlots(
      [
        { label: "quota_codex:primary_300m", limitId: "codex:primary" },
        { label: "quota_codex:secondary_10080m", limitId: "codex:secondary" },
      ],
      {
        classify: (row) =>
          classifyPlanWindow({
            limitId: row.limitId,
            label: row.label,
            windowMinutes: row.label.includes("300m") ? 300 : 10080,
          }),
        buildUnavailable: (slot) => ({
          label: UNAVAILABLE_SLOT_LABEL[slot],
          limitId: slot,
        }),
      },
    );
    expect(filled).toHaveLength(2);
    expect(filled.every((r) => !r.label.startsWith("quota_slot:"))).toBe(true);
  });

  test("leaves an empty list empty (no invented slots)", () => {
    expect(
      fillCanonicalPlanSlots([], {
        classify: () => ({ kind: "extra", key: "x", windowMinutes: null }),
        buildUnavailable: (slot) => ({ label: slot, limitId: slot }),
      }),
    ).toEqual([]);
  });
});
