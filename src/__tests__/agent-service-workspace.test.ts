/**
 * Unit tests for AgentService.readAgentFullConfig() workspace resolution
 * Covers ORC-101: agents.defaults.workspace fallback
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { AgentService } from "../services/agent-service.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

let stateDir: string;
let workspaceDir: string;
let defaultWorkspaceDir: string;
let savedAgentPaths: string | undefined;

beforeAll(() => {
  savedAgentPaths = process.env.AGENT_PATHS;

  // Create a temp state directory mimicking ~/.openclaw/
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "orc101-test-"));

  // The "workspace" dir where the agent's SOUL.md lives
  workspaceDir = path.join(stateDir, "workspace");
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.writeFileSync(
    path.join(workspaceDir, "SOUL.md"),
    `# SOUL.md - Freddy\n\n## Role\nGeneral Assistant\n`,
  );

  // A separate default workspace directory (the one from agents.defaults.workspace)
  defaultWorkspaceDir = path.join(stateDir, "default-workspace");
  fs.mkdirSync(defaultWorkspaceDir, { recursive: true });

  // openclaw.json — agent entry has id but NO workspace field;
  // agents.defaults.workspace IS set
  fs.writeFileSync(
    path.join(stateDir, "openclaw.json"),
    JSON.stringify({
      agents: {
        defaults: {
          workspace: defaultWorkspaceDir,
        },
        list: [
          {
            id: "workspace",
            name: "Freddy",
          },
        ],
      },
    }),
  );

  // Point AGENT_PATHS at the workspace dir so the service discovers the SOUL.md
  process.env.AGENT_PATHS = workspaceDir;
});

afterAll(() => {
  if (savedAgentPaths === undefined) {
    delete process.env.AGENT_PATHS;
  } else {
    process.env.AGENT_PATHS = savedAgentPaths;
  }
  if (stateDir && fs.existsSync(stateDir)) {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

describe("readAgentFullConfig workspace resolution", () => {
  test("uses agents.defaults.workspace when agent entry has no workspace field", async () => {
    const service = new AgentService();
    const config = await service.readAgentFullConfig("workspace");

    expect(config).not.toBeNull();
    expect(config!.workspace).toBe(defaultWorkspaceDir);
  });

  test("uses configEntry.workspace when explicitly set on the agent entry", async () => {
    // Write a second openclaw.json with an explicit workspace on the agent
    const stateDir2 = fs.mkdtempSync(path.join(os.tmpdir(), "orc101-test2-"));
    const wsDir = path.join(stateDir2, "workspace");
    fs.mkdirSync(wsDir, { recursive: true });
    fs.writeFileSync(
      path.join(wsDir, "SOUL.md"),
      `# SOUL.md - Archie\n\n## Role\nOrchestrator\n`,
    );

    const explicitWs = path.join(stateDir2, "explicit-ws");
    fs.mkdirSync(explicitWs, { recursive: true });

    fs.writeFileSync(
      path.join(stateDir2, "openclaw.json"),
      JSON.stringify({
        agents: {
          defaults: {
            workspace: path.join(stateDir2, "should-not-use-this"),
          },
          list: [
            {
              id: "workspace",
              workspace: explicitWs,
            },
          ],
        },
      }),
    );

    const prev = process.env.AGENT_PATHS;
    process.env.AGENT_PATHS = wsDir;
    try {
      const service = new AgentService();
      const config = await service.readAgentFullConfig("workspace");

      expect(config).not.toBeNull();
      // Should use the explicit workspace, not defaults.workspace
      expect(config!.workspace).toBe(explicitWs);
    } finally {
      process.env.AGENT_PATHS = prev;
      fs.rmSync(stateDir2, { recursive: true, force: true });
    }
  });

  test("falls back to SOUL.md directory when no defaults.workspace is set", async () => {
    const stateDir3 = fs.mkdtempSync(path.join(os.tmpdir(), "orc101-test3-"));
    const wsDir = path.join(stateDir3, "workspace");
    fs.mkdirSync(wsDir, { recursive: true });
    fs.writeFileSync(
      path.join(wsDir, "SOUL.md"),
      `# SOUL.md - Lonely\n\n## Role\nHelper\n`,
    );

    // No openclaw.json at all — no defaults.workspace
    const prev = process.env.AGENT_PATHS;
    process.env.AGENT_PATHS = wsDir;
    try {
      const service = new AgentService();
      const config = await service.readAgentFullConfig("workspace");

      expect(config).not.toBeNull();
      // Should fall back to SOUL.md's parent directory
      expect(config!.workspace).toBe(wsDir);
    } finally {
      process.env.AGENT_PATHS = prev;
      fs.rmSync(stateDir3, { recursive: true, force: true });
    }
  });
});
