/**
 * Agent Service
 * Reads and parses agent SOUL.md files and configuration
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { glob } from 'glob';
import { Agent, AgentConfig, SoulMetadata, AgentActivity } from '../types/agents.js';
import { Database } from '../db/database.js';
import { ActivityFilter } from '../types/activity.js';

// Base paths for agents - use AGENT_PATHS env var (colon-separated) or defaults with os.homedir()
const AGENT_BASE_PATHS = process.env.AGENT_PATHS?.split(':').filter(Boolean) || [
  path.join(os.homedir(), '.openclaw-team', 'agents'),
  path.join(os.homedir(), '.openclaw-team', 'workspace-engineer'),
  path.join(os.homedir(), '.openclaw-team', 'workspace-solutions-architect'),
  path.join(os.homedir(), '.openclaw-team', 'workspace-code-reviewer'),
  path.join(os.homedir(), '.openclaw-team', 'workspace-manual-tester'),
  path.join(os.homedir(), '.openclaw-team', 'workspace-engineer-2'),
  path.join(os.homedir(), '.openclaw-team', 'workspace-project-manager'),
  path.join(os.homedir(), '.openclaw-team', 'workspace'),
];

export class AgentService {
  private db: Database | null = null;

  constructor(db?: Database) {
    if (db) {
      this.db = db;
    }
  }

  setDatabase(db: Database): void {
    this.db = db;
  }

  /**
   * Read all agents from the filesystem
   */
  async readAgents(): Promise<Agent[]> {
    const agents: Agent[] = [];
    const processedPaths = new Set<string>();

    for (const basePath of AGENT_BASE_PATHS) {
      if (!fs.existsSync(basePath)) continue;

      // Look for SOUL.md files
      const soulFiles = await glob('**/SOUL.md', { cwd: basePath, absolute: true });
      
      for (const soulFile of soulFiles) {
        // Avoid processing the same path twice (handles symlinks or overlaps)
        if (processedPaths.has(soulFile)) continue;
        processedPaths.add(soulFile);

        try {
          const content = fs.readFileSync(soulFile, 'utf-8');
          const metadata = this.parseSOULMarkdown(content);
          
          // Extract agent ID from path
          const soulDir = path.dirname(soulFile);
          const parentDir = path.basename(soulDir);
          const agentId = this.extractAgentId(soulFile, basePath);

          // Try to read agent.json for additional config
          const agentConfig = await this.readAgentConfig(soulDir);

          agents.push({
            id: agentId,
            name: agentConfig?.name || metadata.name || this.guessNameFromPath(soulFile),
            role: metadata.role || agentConfig?.role || 'Unknown',
            model: metadata.model || agentConfig?.model || 'unknown',
            gitAuthorName: metadata.gitAuthorName || agentConfig?.gitAuthorName,
            gitAuthorEmail: metadata.gitAuthorEmail || agentConfig?.gitAuthorEmail,
            skills: agentConfig?.allowedSkills || [],
          });
        } catch (err) {
          console.warn(`[AgentService] Failed to parse ${soulFile}:`, err);
        }
      }
    }

    return agents;
  }

  /**
   * Read a specific agent by ID
   */
  async readAgent(id: string): Promise<Agent | null> {
    const agents = await this.readAgents();
    return agents.find(a => a.id === id) || null;
  }

  /**
   * Get raw SOUL.md content for an agent
   */
  async readAgentSoul(id: string): Promise<string | null> {
    for (const basePath of AGENT_BASE_PATHS) {
      if (!fs.existsSync(basePath)) continue;

      const soulFiles = await glob('**/SOUL.md', { cwd: basePath, absolute: true });
      
      for (const soulFile of soulFiles) {
        const agentId = this.extractAgentId(soulFile, basePath);
        
        if (agentId === id) {
          try {
            return fs.readFileSync(soulFile, 'utf-8');
          } catch (err) {
            console.warn(`[AgentService] Failed to read ${soulFile}:`, err);
            return null;
          }
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
      role: '',
    };

    // Extract role (usually in a heading like "## Role" followed by content)
    const roleMatch = content.match(/##\s*Role\s*\n+([^\n#]+)/i);
    if (roleMatch) {
      metadata.role = roleMatch[1].trim();
    }

    // Extract model (look for model references)
    const modelPatterns = [
      /model[:\s]+([^\n,]+)/i,
      /using\s+([^\n]+model)/i,
      /model[:\s]+`([^`]+)`/,
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
  async getAgentActivity(id: string, limit: number = 50): Promise<AgentActivity[]> {
    if (!this.db) {
      console.warn('[AgentService] Database not initialized');
      return [];
    }

    try {
      // Get activities for this agent (filter by actor ID containing the agent ID)
      const filter: ActivityFilter = {
        actorId: id,
        limit,
      };

      const activities = await this.db.getActivities(filter);
      
      return activities.map(a => ({
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
      console.error('[AgentService] Failed to get agent activity:', err);
      return [];
    }
  }

  /**
   * Get skills accessible to a specific agent
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
    const configPath = path.join(agentDir, 'agent.json');
    
    if (fs.existsSync(configPath)) {
      try {
        const content = fs.readFileSync(configPath, 'utf-8');
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
    // Get the path relative to the base
    const relativePath = path.relative(basePath, soulFilePath);
    const parts = relativePath.split(path.sep);
    
    // The agent ID is typically the first directory component
    // e.g., workspace-engineer/SOUL.md -> workspace-engineer
    // or agents/engineer/SOUL.md -> engineer
    
    if (parts[0] === 'workspace') {
      // For workspace/SOUL.md, the agent is the parent of workspace
      return parts[1] || path.basename(path.dirname(basePath));
    }
    
    return parts[0] || 'unknown';
  }

  /**
   * Guess agent name from path
   */
  private guessNameFromPath(soulFilePath: string): string {
    const parts = soulFilePath.split(path.sep);
    // Look for workspace-* pattern
    for (let i = parts.length - 1; i >= 0; i--) {
      if (parts[i].startsWith('workspace-')) {
        return parts[i].replace('workspace-', '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      }
      if (parts[i] === 'workspace') {
        return parts[i - 1] || 'Orchestrator';
      }
    }
    return 'Unknown Agent';
  }
}
