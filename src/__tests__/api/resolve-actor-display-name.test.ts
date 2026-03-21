/**
 * Tests for resolveActorDisplayName — centralised agent ID → display name mapping.
 * ORC-39: Recent Activity shows unknown agent IDs instead of readable agent names.
 * ORC-98: Actor display name now resolves from AgentService identity config.
 */

import { describe, test, expect, mock } from "bun:test";
import { resolveActorDisplayName } from "../../api/routes.js";
import { AgentService } from "../../services/agent-service.js";

describe("resolveActorDisplayName", () => {
  test("resolves known agent IDs to display names with emoji (no agentService)", async () => {
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
      const result = await resolveActorDisplayName(id);
      expect(result.displayName).toBe(expectedName);
      expect(result.emoji).toBe(expectedEmoji);
    }
  });

  test('resolves "unknown" with a question mark emoji', async () => {
    const result = await resolveActorDisplayName("unknown");
    expect(result.displayName).toBe("Unknown Agent");
    expect(result.emoji).toBe("❓");
  });

  test("title-cases unmapped agent IDs with a robot emoji", async () => {
    const result = await resolveActorDisplayName("my-custom-agent");
    expect(result.displayName).toBe("My Custom Agent");
    expect(result.emoji).toBe("🤖");
  });

  test("handles underscores in unmapped IDs", async () => {
    const result = await resolveActorDisplayName("data_processor");
    expect(result.displayName).toBe("Data Processor");
    expect(result.emoji).toBe("🤖");
  });

  test("handles single-word unmapped IDs", async () => {
    const result = await resolveActorDisplayName("deployer");
    expect(result.displayName).toBe("Deployer");
    expect(result.emoji).toBe("🤖");
  });

  test("is case-sensitive for known IDs", async () => {
    // "Engineer" (capitalised) should not match "engineer"
    const result = await resolveActorDisplayName("Engineer");
    expect(result.displayName).toBe("Engineer");
    expect(result.emoji).toBe("🤖"); // fallback, not the known mapping
  });

  test("uses identity from AgentService when profileId is provided", async () => {
    const mockAgentService = {
      readAgentFullConfig: mock(() =>
        Promise.resolve({
          workspace: "/tmp/test",
          identity: { name: "Freddy", emoji: "🐻" },
        }),
      ),
    } as unknown as AgentService;

    const result = await resolveActorDisplayName(
      "main",
      "default",
      mockAgentService,
    );
    expect(result.displayName).toBe("Freddy");
    expect(result.emoji).toBe("🐻");
    expect(mockAgentService.readAgentFullConfig).toHaveBeenCalledWith(
      "main",
      "default",
    );
  });

  test("uses identity name with default emoji when emoji not configured", async () => {
    const mockAgentService = {
      readAgentFullConfig: mock(() =>
        Promise.resolve({
          workspace: "/tmp/test",
          identity: { name: "Archie" },
        }),
      ),
    } as unknown as AgentService;

    const result = await resolveActorDisplayName(
      "main",
      "archie",
      mockAgentService,
    );
    expect(result.displayName).toBe("Archie");
    expect(result.emoji).toBe("🤖");
  });

  test("falls back to static map when agent has no identity", async () => {
    const mockAgentService = {
      readAgentFullConfig: mock(() =>
        Promise.resolve({
          workspace: "/tmp/test",
          identity: undefined,
        }),
      ),
    } as unknown as AgentService;

    const result = await resolveActorDisplayName(
      "engineer",
      "default",
      mockAgentService,
    );
    expect(result.displayName).toBe("Engineer");
    expect(result.emoji).toBe("🔧");
  });

  test("falls back to static map when agent not found", async () => {
    const mockAgentService = {
      readAgentFullConfig: mock(() => Promise.resolve(null)),
    } as unknown as AgentService;

    const result = await resolveActorDisplayName(
      "main",
      "default",
      mockAgentService,
    );
    expect(result.displayName).toBe("Orchestrator");
    expect(result.emoji).toBe("🎯");
  });

  test("falls back to title-case when agent not found and not in static map", async () => {
    const mockAgentService = {
      readAgentFullConfig: mock(() => Promise.resolve(null)),
    } as unknown as AgentService;

    const result = await resolveActorDisplayName(
      "custom-bot",
      "default",
      mockAgentService,
    );
    expect(result.displayName).toBe("Custom Bot");
    expect(result.emoji).toBe("🤖");
  });

  test("falls back to static map when AgentService throws", async () => {
    const mockAgentService = {
      readAgentFullConfig: mock(() =>
        Promise.reject(new Error("filesystem error")),
      ),
    } as unknown as AgentService;

    const result = await resolveActorDisplayName(
      "main",
      "default",
      mockAgentService,
    );
    expect(result.displayName).toBe("Orchestrator");
    expect(result.emoji).toBe("🎯");
  });

  test("skips AgentService lookup when no profileId", async () => {
    const mockAgentService = {
      readAgentFullConfig: mock(() =>
        Promise.resolve({
          workspace: "/tmp/test",
          identity: { name: "Freddy", emoji: "🐻" },
        }),
      ),
    } as unknown as AgentService;

    const result = await resolveActorDisplayName(
      "main",
      undefined,
      mockAgentService,
    );
    // Should use static map, not AgentService
    expect(result.displayName).toBe("Orchestrator");
    expect(result.emoji).toBe("🎯");
    expect(mockAgentService.readAgentFullConfig).not.toHaveBeenCalled();
  });
});
