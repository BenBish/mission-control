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

/**
 * Shape of an agent entry in openclaw.json → agents.list[]
 */
interface OpenClawAgentEntry {
  id: string;
  name?: string;
  workspace?: string;
  agentDir?: string;
  default?: boolean;
  model?: string | { primary?: string };
  skills?: string[];
  identity?: { name?: string; emoji?: string };
  subagents?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Relevant slice of openclaw.json
 */
interface OpenClawConfig {
  agents?: {
    defaults?: Record<string, unknown>;
    list?: OpenClawAgentEntry[];
  };
  [key: string]: unknown;
}

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

/**
 * Get agent base paths filtered for a specific profile.
 * Maps profile names to their state directories:
 *   "default" → ~/.openclaw/...
 *   "team"    → ~/.openclaw-team/...
 *   other     → ~/.openclaw-<profile>/...
 */
function getAgentBasePathsForProfile(profileId: string): string[] {
  const stateDir =
    profileId === "default"
      ? path.join(os.homedir(), ".openclaw")
      : path.join(os.homedir(), `.openclaw-${profileId}`);

  // Return all paths under the profile's state directory
  return [
    path.join(stateDir, "agents"),
    path.join(stateDir, "workspace-engineer"),
    path.join(stateDir, "workspace-solutions-architect"),
    path.join(stateDir, "workspace-code-reviewer"),
    path.join(stateDir, "workspace-manual-tester"),
    path.join(stateDir, "workspace-engineer-2"),
    path.join(stateDir, "workspace-project-manager"),
    path.join(stateDir, "workspace"),
  ];
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
  private agentsCacheKey: string = "";
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
   * Read all agents from the filesystem (cached with 30s TTL).
   * When `profileId` is provided, the agent base paths are filtered to
   * the state directory for that profile (e.g. ~/.openclaw-team for "team").
   *
   * Agent skill assignments are read from `openclaw.json` in the profile's
   * state directory (agents.list[].skills), not from per-agent `agent.json`
   * files.
   */
  async readAgents(profileId?: string): Promise<Agent[]> {
    // Use profile-qualified cache key
    const cacheKey = profileId || "__all__";
    if (
      this.agentsCache &&
      Date.now() < this.agentsCache.expiry &&
      this.agentsCacheKey === cacheKey
    ) {
      return this.agentsCache.data;
    }

    const agents: Agent[] = [];
    const processedPaths = new Set<string>();
    const soulPaths = new Map<string, string>();

    const basePaths = profileId
      ? getAgentBasePathsForProfile(profileId)
      : getAgentBasePaths();

    // Load openclaw.json config to get agent skill assignments and metadata.
    // Build a lookup map from agent ID → config entry for fast matching.
    const openclawConfig = await this.readOpenClawConfig(profileId);
    const configByAgentId = new Map<string, OpenClawAgentEntry>();
    for (const entry of openclawConfig?.agents?.list ?? []) {
      if (entry.id) {
        configByAgentId.set(entry.id, entry);
      }
    }

    for (const basePath of basePaths) {
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

          // Look up this agent's config entry from openclaw.json
          const configEntry = configByAgentId.get(agentId);

          // Resolve model from config entry (may be string or { primary: string })
          const configModel = configEntry?.model
            ? typeof configEntry.model === "string"
              ? configEntry.model
              : configEntry.model.primary
            : undefined;

          soulPaths.set(agentId, soulFile);

          agents.push({
            id: agentId,
            name:
              configEntry?.identity?.name ||
              agentConfig?.name ||
              metadata.name ||
              this.guessNameFromPath(soulFile),
            role: metadata.role || agentConfig?.role || "Unknown",
            model:
              configModel || metadata.model || agentConfig?.model || "unknown",
            gitAuthorName: metadata.gitAuthorName || agentConfig?.gitAuthorName,
            gitAuthorEmail:
              metadata.gitAuthorEmail || agentConfig?.gitAuthorEmail,
            skills: configEntry?.skills ?? agentConfig?.allowedSkills ?? [],
          });
        } catch (err) {
          console.warn(`[AgentService] Failed to parse ${soulFile}:`, err);
        }
      }
    }

    const expiry = Date.now() + CACHE_TTL_MS;
    this.agentsCache = { data: agents, expiry };
    this.agentsCacheKey = cacheKey;
    this.soulPathCache = { data: soulPaths, expiry };

    return agents;
  }

  /**
   * Read a specific agent by ID, optionally scoped to a profile.
   */
  async readAgent(id: string, profileId?: string): Promise<Agent | null> {
    const agents = await this.readAgents(profileId);
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
   * Read openclaw.json config for a profile to get agent skill assignments
   * and other metadata that lives in the central config rather than per-agent
   * files.
   *
   * Profile mapping:
   *   "default" → ~/.openclaw/openclaw.json
   *   "team"    → ~/.openclaw-team/openclaw.json
   *   other     → ~/.openclaw-<profile>/openclaw.json
   *   undefined → scans all DEFAULT_AGENT_PATHS parents for openclaw.json
   */
  private async readOpenClawConfig(
    profileId?: string,
  ): Promise<OpenClawConfig | null> {
    const configPaths: string[] = [];

    if (profileId) {
      const stateDir =
        profileId === "default"
          ? path.join(os.homedir(), ".openclaw")
          : path.join(os.homedir(), `.openclaw-${profileId}`);
      configPaths.push(path.join(stateDir, "openclaw.json"));
    } else {
      // When no profile is specified, try to find openclaw.json in any of
      // the base paths' parent directories (state dirs)
      const seen = new Set<string>();
      for (const basePath of getAgentBasePaths()) {
        // The state dir is the parent of directories like workspace-engineer
        const parent = path.dirname(basePath);
        const configPath = path.join(parent, "openclaw.json");
        if (!seen.has(configPath)) {
          seen.add(configPath);
          configPaths.push(configPath);
        }
      }
    }

    // Try each candidate path; return the first one that parses successfully
    for (const configPath of configPaths) {
      if (!existsSync(configPath)) continue;
      try {
        const content = await fs.readFile(configPath, "utf-8");
        return JSON.parse(content) as OpenClawConfig;
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
