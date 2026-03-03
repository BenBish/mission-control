/**
 * Agent Service
 * Reads and parses agent SOUL.md files and configuration
 */

import * as fs from "fs/promises";
import { existsSync } from "fs";
import * as path from "path";
import * as os from "os";
import { glob } from "glob";
import {
  Agent,
  AgentConfig,
  SoulMetadata,
  AgentActivity,
} from "../types/agents.js";
import { Database } from "../db/database.js";
import { ActivityFilter } from "../types/activity.js";

// Base paths for agents - use AGENT_PATHS env var or defaults with os.homedir()
// Resolved lazily so env vars set at runtime (e.g. in tests) are respected.
const DEFAULT_AGENT_PATHS = [
  path.join(os.homedir(), ".openclaw-team", "agents"),
  path.join(os.homedir(), ".openclaw-team", "workspace-engineer"),
  path.join(os.homedir(), ".openclaw-team", "workspace-solutions-architect"),
  path.join(os.homedir(), ".openclaw-team", "workspace-code-reviewer"),
  path.join(os.homedir(), ".openclaw-team", "workspace-manual-tester"),
  path.join(os.homedir(), ".openclaw-team", "workspace-engineer-2"),
  path.join(os.homedir(), ".openclaw-team", "workspace-project-manager"),
  path.join(os.homedir(), ".openclaw-team", "workspace"),
];

function getAgentBasePaths(): string[] {
  return (
    process.env.AGENT_PATHS?.split(path.delimiter).filter(Boolean) ||
    DEFAULT_AGENT_PATHS
  );
}

// Cache TTL in milliseconds
const CACHE_TTL_MS = 30_000;

interface CacheEntry<T> {
  data: T;
  expiry: number;
}

export class AgentService {
  private db: Database | null = null;
  private agentsCache: CacheEntry<Agent[]> | null = null;
  // Map from agent ID to SOUL.md file path, populated when agents are read
  private soulPathCache: CacheEntry<Map<string, string>> | null = null;

  constructor(db?: Database) {
    if (db) {
      this.db = db;
    }
  }

  setDatabase(db: Database): void {
    this.db = db;
  }

  /**
   * Read all agents from the filesystem (cached with 30s TTL)
   */
  async readAgents(): Promise<Agent[]> {
    if (this.agentsCache && Date.now() < this.agentsCache.expiry) {
      return this.agentsCache.data;
    }

    const agents: Agent[] = [];
    const processedPaths = new Set<string>();
    const soulPaths = new Map<string, string>();

    for (const basePath of getAgentBasePaths()) {
      if (!existsSync(basePath)) continue;

      const soulFiles = await glob("**/SOUL.md", {
        cwd: basePath,
        absolute: true,
        ignore: ["**/node_modules/**", "**/.git/**"],
      });

      for (const soulFile of soulFiles) {
        if (processedPaths.has(soulFile)) continue;
        processedPaths.add(soulFile);

        try {
          const content = await fs.readFile(soulFile, "utf-8");
          const metadata = this.parseSOULMarkdown(content);

          const soulDir = path.dirname(soulFile);
          const agentId = this.extractAgentId(soulFile, basePath);
          const agentConfig = await this.readAgentConfig(soulDir);

          soulPaths.set(agentId, soulFile);

          agents.push({
            id: agentId,
            name:
              agentConfig?.name ||
              metadata.name ||
              this.guessNameFromPath(soulFile),
            role: metadata.role || agentConfig?.role || "Unknown",
            model: metadata.model || agentConfig?.model || "unknown",
            gitAuthorName: metadata.gitAuthorName || agentConfig?.gitAuthorName,
            gitAuthorEmail:
              metadata.gitAuthorEmail || agentConfig?.gitAuthorEmail,
            skills: agentConfig?.allowedSkills || [],
          });
        } catch (err) {
          console.warn(`[AgentService] Failed to parse ${soulFile}:`, err);
        }
      }
    }

    const expiry = Date.now() + CACHE_TTL_MS;
    this.agentsCache = { data: agents, expiry };
    this.soulPathCache = { data: soulPaths, expiry };

    return agents;
  }

  /**
   * Read a specific agent by ID
   */
  async readAgent(id: string): Promise<Agent | null> {
    const agents = await this.readAgents();
    return agents.find((a) => a.id === id) || null;
  }

  /**
   * Get raw SOUL.md content for an agent
   */
  async readAgentSoul(id: string): Promise<string | null> {
    // Ensure cache is populated
    await this.readAgents();

    if (this.soulPathCache && Date.now() < this.soulPathCache.expiry) {
      const soulFile = this.soulPathCache.data.get(id);
      if (soulFile) {
        try {
          return await fs.readFile(soulFile, "utf-8");
        } catch (err) {
          console.warn(`[AgentService] Failed to read ${soulFile}:`, err);
          return null;
        }
      }
    }

    return null;
  }

  /**
   * Parse SOUL.md markdown content to extract metadata
   */
  parseSOULMarkdown(content: string): SoulMetadata {
    const metadata: SoulMetadata = {
      role: "",
    };

    // Extract role — prefer the tagline after the em-dash in the intro
    // ("You are the **Engineer** — you turn designs into working code."),
    // fall back to ## Role paragraph content.
    const taglineMatch = content.match(
      /You are (?:the )?\*\*[^*]+\*\*\s*[-–—]\s*([^\n.]+)/i,
    );
    if (taglineMatch) {
      metadata.role = taglineMatch[1].trim();
    } else {
      const roleHeadingMatch = content.match(/##\s*Role\s*\n+([^\n#]+)/i);
      if (roleHeadingMatch) {
        metadata.role = roleHeadingMatch[1].trim();
      }
    }

    // Extract model — try structured formats first, then fallback
    const modelPatterns: RegExp[] = [
      // "Model: `openrouter/...`" on its own line
      /^model[:\s]+`([^`]+)`/im,
      // "Model: openrouter/..." on its own line
      /^model[:\s]+([^\n,]+)/im,
      // "## Model" heading followed by value on next non-blank line
      /^##\s*Model\s*\n+([^\n#]+)/im,
    ];
    for (const pattern of modelPatterns) {
      const match = content.match(pattern);
      if (match) {
        metadata.model = match[1].trim();
        break;
      }
    }

    // Extract git author info
    const gitNameMatch = content.match(/GIT_AUTHOR_NAME\s*=\s*([^\n]+)/);
    if (gitNameMatch) {
      metadata.gitAuthorName = gitNameMatch[1].trim();
    }

    const gitEmailMatch = content.match(/GIT_AUTHOR_EMAIL\s*=\s*([^\n]+)/);
    if (gitEmailMatch) {
      metadata.gitAuthorEmail = gitEmailMatch[1].trim();
    }

    // Try to extract name from the first heading
    const nameMatch = content.match(/#\s*SOUL\.md\s*[-–—]\s*([^\n]+)/i);
    if (nameMatch) {
      metadata.name = nameMatch[1].trim();
    }

    return metadata;
  }

  /**
   * Get agent activity from the database
   */
  async getAgentActivity(
    id: string,
    limit: number = 50,
  ): Promise<AgentActivity[]> {
    if (!this.db) {
      console.warn("[AgentService] Database not initialized");
      return [];
    }

    try {
      const filter: ActivityFilter = {
        actorId: id,
        limit,
      };

      const activities = await this.db.getActivities(filter);

      return activities.map((a) => ({
        id: a.id,
        sessionId: a.sessionId,
        timestamp: a.timestamp,
        actionType: a.actionType,
        description: a.description,
        status: a.status,
        toolName: a.toolName,
        tokens: a.tokens,
        cost: a.cost,
      }));
    } catch (err) {
      console.error("[AgentService] Failed to get agent activity:", err);
      return [];
    }
  }

  /**
   * Get skills accessible to a specific agent (from pre-loaded agent data)
   */
  async getAgentSkills(id: string): Promise<string[]> {
    const agent = await this.readAgent(id);
    if (!agent) {
      return [];
    }
    return agent.skills || [];
  }

  /**
   * Try to read agent.json config file from agent directory
   */
  private async readAgentConfig(agentDir: string): Promise<AgentConfig | null> {
    const configPath = path.join(agentDir, "agent.json");

    if (existsSync(configPath)) {
      try {
        const content = await fs.readFile(configPath, "utf-8");
        return JSON.parse(content);
      } catch (err) {
        console.warn(`[AgentService] Failed to parse ${configPath}:`, err);
      }
    }
    return null;
  }

  /**
   * Extract agent ID from SOUL.md path
   */
  private extractAgentId(soulFilePath: string, basePath: string): string {
    const relativePath = path.relative(basePath, soulFilePath);
    const parts = relativePath.split(path.sep);

    // Handle SOUL.md directly in base path (e.g., /agents/SOUL.md)
    if (parts[0] === "SOUL.md") {
      return path.basename(basePath);
    }

    if (parts[0] === "workspace") {
      // For workspace/SOUL.md, the agent is the parent of workspace
      return parts[1] || path.basename(path.dirname(basePath));
    }

    return parts[0] || "unknown";
  }

  /**
   * Guess agent name from path
   */
  private guessNameFromPath(soulFilePath: string): string {
    const parts = soulFilePath.split(path.sep);
    for (let i = parts.length - 1; i >= 0; i--) {
      if (parts[i].startsWith("workspace-")) {
        return parts[i]
          .replace("workspace-", "")
          .replace(/-/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase());
      }
      if (parts[i] === "workspace") {
        return parts[i - 1] || "Orchestrator";
      }
    }
    return "Unknown Agent";
  }
}
