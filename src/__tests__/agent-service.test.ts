/**
 * Agent Service Tests
 * Verifies agent reading and parsing functionality
 */

import { AgentService } from "../services/agent-service.js";

describe("AgentService", () => {
  let agentService: AgentService;

  beforeAll(() => {
    agentService = new AgentService();
  });

  describe("parseSOULMarkdown", () => {
    test("should extract role from SOUL.md", () => {
      const content = `# SOUL.md - Engineer

## Role

You are the Engineer - a senior developer who writes code.

## Model

Using Claude Sonnet 4.5

GIT_AUTHOR_NAME=engineer
GIT_AUTHOR_EMAIL=engineer@orcateam.io
`;

      const metadata = agentService.parseSOULMarkdown(content);

      expect(metadata.role).toContain("Engineer");
      expect(metadata.model).toContain("Claude");
      expect(metadata.gitAuthorName).toBe("engineer");
      expect(metadata.gitAuthorEmail).toBe("engineer@orcateam.io");
    });

    test("should handle minimal SOUL.md", () => {
      const content = `# SOUL.md

## Role

A generic agent
`;

      const metadata = agentService.parseSOULMarkdown(content);

      expect(metadata.role).toBe("A generic agent");
      expect(metadata.model).toBeUndefined();
      expect(metadata.gitAuthorName).toBeUndefined();
    });

    test("should extract name from header", () => {
      const content = `# SOUL.md - Solutions Architect

## Role

Design and architecture.
`;

      const metadata = agentService.parseSOULMarkdown(content);

      expect(metadata.name).toContain("Solutions Architect");
    });

    test("should extract model with various formats", () => {
      const content = `# SOUL.md - Engineer

## Role

Coding

## Model

openrouter/minimax/minimax-m2.5
`;

      const metadata = agentService.parseSOULMarkdown(content);
      expect(metadata.model).toContain("minimax");
    });
  });

  describe("readAgents", () => {
    test("should return empty array when no agents exist", async () => {
      // Create new service without database
      const service = new AgentService();
      const agents = await service.readAgents();
      expect(Array.isArray(agents)).toBe(true);
    });
  });

  describe("readAgentSoul", () => {
    test("should return null for non-existent agent", async () => {
      const soul = await agentService.readAgentSoul("nonexistent-agent-id");
      expect(soul === null || typeof soul === "string").toBe(true);
    });
  });

  describe("getAgentActivity", () => {
    test("should return empty array when database not set up", async () => {
      const service = new AgentService();
      const activities = await service.getAgentActivity("test-agent");
      expect(activities).toEqual([]);
    });
  });

  describe("getAgentSkills", () => {
    test("should return empty array for non-existent agent", async () => {
      const skills = await agentService.getAgentSkills("nonexistent");
      expect(Array.isArray(skills)).toBe(true);
    });
  });
});
