/**
 * Agent Service
 * Handles reading agent configurations and SOUL.md files
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';

interface OpenClawConfig {
  agents: {
    list: Array<{
      id: string;
      workspace?: string;
      identity?: {
        name?: string;
        emoji?: string;
      };
      model?: {
        primary?: string;
      };
    }>;
  };
}

interface AgentMetadata {
  soulMarkdown?: string;
  config?: {
    workspace?: string;
    model?: string;
    gitConfig?: {
      author?: string;
      email?: string;
    };
    identity?: {
      name?: string;
      emoji?: string;
    };
  };
}

class AgentService {
  private openClawConfigPath: string;
  private configCache: Map<string, AgentMetadata> = new Map();

  constructor() {
    // Use process.env.HOME or os.homedir() to get user home directory
    const homeDir = process.env.HOME || os.homedir();
    this.openClawConfigPath = path.join(homeDir, '.openclaw-team', 'openclaw.json');
  }

  /**
   * Load OpenClaw configuration
   */
  private async loadOpenClawConfig(): Promise<OpenClawConfig> {
    try {
      const configData = await fs.readFile(this.openClawConfigPath, 'utf-8');
      return JSON.parse(configData);
    } catch (error) {
      console.error('Failed to load openclaw.json:', error);
      return { agents: { list: [] } };
    }
  }

  /**
   * Read SOUL.md from agent workspace
   */
  private async readSOULMarkdown(workspacePath: string): Promise<string | undefined> {
    try {
      const soulPath = path.join(workspacePath, 'SOUL.md');
      const content = await fs.readFile(soulPath, 'utf-8');
      return content;
    } catch (error) {
      console.error(`Failed to read SOUL.md from ${workspacePath}:`, error);
      return undefined;
    }
  }

  /**
   * Parse agent-specific configuration files
   */
  private async parseAgentConfig(
    workspacePath: string,
    config: OpenClawConfig['agents']['list'][0]
  ): Promise<AgentMetadata['config']> {
    try {
      // Try to read AGENTS.md for git config
      let gitConfig = undefined;
      try {
        const agentsPath = path.join(workspacePath, 'AGENTS.md');
        const content = await fs.readFile(agentsPath, 'utf-8');
        
        // Extract GIT_AUTHOR_NAME and GIT_AUTHOR_EMAIL
        const nameMatch = content.match(/GIT_AUTHOR_NAME\s*=\s*(.+)/);
        const emailMatch = content.match(/GIT_AUTHOR_EMAIL\s*=\s*(.+)/);
        
        if (nameMatch || emailMatch) {
          gitConfig = {
            author: nameMatch ? nameMatch[1].trim() : undefined,
            email: emailMatch ? emailMatch[1].trim() : undefined,
          };
        }
      } catch {
        // AGENTS.md may not exist
      }

      return {
        workspace: config.workspace,
        model: config.model?.primary,
        gitConfig,
        identity: config.identity,
      };
    } catch (error) {
      console.error('Failed to parse agent config:', error);
      return {};
    }
  }

  /**
   * Get agent metadata (SOUL.md + config)
   */
  async getAgentMetadata(agentId: string): Promise<AgentMetadata | null> {
    // Check cache first
    if (this.configCache.has(agentId)) {
      return this.configCache.get(agentId) || null;
    }

    try {
      const openClawConfig = await this.loadOpenClawConfig();
      const agentConfig = openClawConfig.agents.list.find(a => a.id === agentId);
      
      if (!agentConfig || !agentConfig.workspace) {
        return null;
      }

      const metadata: AgentMetadata = {};

      // Read SOUL.md
      const soul = await this.readSOULMarkdown(agentConfig.workspace);
      if (soul) {
        metadata.soulMarkdown = soul;
      }

      // Parse agent config
      const config = await this.parseAgentConfig(agentConfig.workspace, agentConfig);
      if (Object.keys(config).length > 0) {
        metadata.config = config;
      }

      // Cache the result
      this.configCache.set(agentId, metadata);

      return Object.keys(metadata).length > 0 ? metadata : null;
    } catch (error) {
      console.error('Failed to get agent metadata:', error);
      return null;
    }
  }

  /**
   * Clear cache (for testing or refresh)
   */
  clearCache(): void {
    this.configCache.clear();
  }
}

// Create singleton instance
const agentService = new AgentService();

export { agentService };
