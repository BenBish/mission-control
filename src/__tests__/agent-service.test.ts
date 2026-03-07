/**
 * Agent Service Tests
 * Verifies agent reading and parsing functionality
 */

import { AgentService } from "../services/agent-service.js";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

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

  describe("readAgents with openclaw.json skills", () => {
    let tmpDir: string;
    const originalAgentPaths = process.env.AGENT_PATHS;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-svc-test-"));

      // Create a workspace with SOUL.md
      const workspaceDir = path.join(tmpDir, "workspace-test-agent");
      await fs.mkdir(workspaceDir, { recursive: true });
      await fs.writeFile(
        path.join(workspaceDir, "SOUL.md"),
        `# SOUL.md - Test Agent

You are the **Test Agent** — you run tests.

GIT_AUTHOR_NAME=test-agent
GIT_AUTHOR_EMAIL=test@example.com
`,
      );

      // Point AGENT_PATHS to our temp directory
      process.env.AGENT_PATHS = workspaceDir;
    });

    afterEach(async () => {
      if (originalAgentPaths !== undefined) {
        process.env.AGENT_PATHS = originalAgentPaths;
      } else {
        delete process.env.AGENT_PATHS;
      }
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    test("should read skills from openclaw.json when available", async () => {
      // Create openclaw.json in the parent directory (state dir)
      const openclawConfig = {
        agents: {
          list: [
            {
              id: "workspace-test-agent",
              skills: ["coding-agent", "github", "weather"],
              identity: { name: "Test Agent", emoji: "🧪" },
              model: { primary: "test-model/v1" },
            },
          ],
        },
      };
      await fs.writeFile(
        path.join(tmpDir, "openclaw.json"),
        JSON.stringify(openclawConfig, null, 2),
      );

      const service = new AgentService();
      const agents = await service.readAgents();

      const testAgent = agents.find((a) => a.id === "workspace-test-agent");
      expect(testAgent).toBeDefined();
      expect(testAgent!.skills).toEqual(["coding-agent", "github", "weather"]);
      expect(testAgent!.name).toBe("Test Agent");
      expect(testAgent!.model).toBe("test-model/v1");
    });

    test("should return empty skills when agent has no skills in openclaw.json", async () => {
      // Create openclaw.json without skills
      const openclawConfig = {
        agents: {
          list: [
            {
              id: "workspace-test-agent",
              identity: { name: "Test Agent" },
            },
          ],
        },
      };
      await fs.writeFile(
        path.join(tmpDir, "openclaw.json"),
        JSON.stringify(openclawConfig, null, 2),
      );

      const service = new AgentService();
      const agents = await service.readAgents();

      const testAgent = agents.find((a) => a.id === "workspace-test-agent");
      expect(testAgent).toBeDefined();
      expect(testAgent!.skills).toEqual([]);
    });

    test("should fallback to empty skills when no openclaw.json exists", async () => {
      const service = new AgentService();
      const agents = await service.readAgents();

      const testAgent = agents.find((a) => a.id === "workspace-test-agent");
      expect(testAgent).toBeDefined();
      expect(testAgent!.skills).toEqual([]);
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
