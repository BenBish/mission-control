/**
 * Tests for resolveActorDisplayName — centralised agent ID → display name mapping.
 * ORC-39: Recent Activity shows unknown agent IDs instead of readable agent names.
 */

import { resolveActorDisplayName } from "../../api/routes.js";

describe("resolveActorDisplayName", () => {
  it("resolves known agent IDs to display names with emoji", () => {
    const cases: Array<[string, string, string]> = [
      ["main", "Orchestrator", "🎯"],
      ["engineer", "Engineer", "🔧"],
      ["engineer-2", "Engineer 2", "🔧"],
      ["solutions-architect", "Solutions Architect", "🏗️"],
      ["code-reviewer", "Code Reviewer", "🔍"],
      ["manual-tester", "Manual Tester", "🧪"],
      ["project-manager", "Project Manager", "📋"],
    ];

    for (const [id, expectedName, expectedEmoji] of cases) {
      const result = resolveActorDisplayName(id);
      expect(result.displayName).toBe(expectedName);
      expect(result.emoji).toBe(expectedEmoji);
    }
  });

  it('resolves "unknown" with a question mark emoji', () => {
    const result = resolveActorDisplayName("unknown");
    expect(result.displayName).toBe("Unknown Agent");
    expect(result.emoji).toBe("❓");
  });

  it("title-cases unmapped agent IDs with a robot emoji", () => {
    const result = resolveActorDisplayName("my-custom-agent");
    expect(result.displayName).toBe("My Custom Agent");
    expect(result.emoji).toBe("🤖");
  });

  it("handles underscores in unmapped IDs", () => {
    const result = resolveActorDisplayName("data_processor");
    expect(result.displayName).toBe("Data Processor");
    expect(result.emoji).toBe("🤖");
  });

  it("handles single-word unmapped IDs", () => {
    const result = resolveActorDisplayName("deployer");
    expect(result.displayName).toBe("Deployer");
    expect(result.emoji).toBe("🤖");
  });

  it("is case-sensitive for known IDs", () => {
    // "Engineer" (capitalised) should not match "engineer"
    const result = resolveActorDisplayName("Engineer");
    expect(result.displayName).toBe("Engineer");
    expect(result.emoji).toBe("🤖"); // fallback, not the known mapping
  });
});
