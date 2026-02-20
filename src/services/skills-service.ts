/**
 * Skills Service
 * Reads and parses skill SKILL.md files and generates permissions matrix
 */

import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { glob } from 'glob';
import { Skill, SkillConfig, PermissionsMatrix, Agent } from '../types/agents.js';
import { AgentService } from './agent-service.js';

// Resolved lazily so env vars set at runtime are respected.
// When SKILL_PATH is set, only that path is used.
function getSkillBasePaths(): string[] {
  if (process.env.SKILL_PATH) {
    return [process.env.SKILL_PATH];
  }
  return [
    path.join(os.homedir(), '.local/share/openclaw/skills'),
    '/usr/share/openclaw/skills',
    '/opt/openclaw/skills',
  ];
}

// Cache TTL in milliseconds
const CACHE_TTL_MS = 30_000;

interface CacheEntry<T> {
  data: T;
  expiry: number;
}

export class SkillsService {
  private agentService: AgentService;
  private skillsCache: CacheEntry<Skill[]> | null = null;

  constructor(agentService: AgentService) {
    this.agentService = agentService;
  }

  /**
   * Read all skills from the filesystem (cached with 30s TTL)
   */
  async readSkills(): Promise<Skill[]> {
    if (this.skillsCache && Date.now() < this.skillsCache.expiry) {
      return this.skillsCache.data;
    }

    const skills: Skill[] = [];
    const processedDirs = new Set<string>();

    for (const basePath of getSkillBasePaths()) {
      if (!existsSync(basePath)) continue;

      const skillFiles = await glob('**/SKILL.md', {
        cwd: basePath,
        absolute: true,
        ignore: ['**/node_modules/**', '**/.git/**'],
      });

      for (const skillFile of skillFiles) {
        const skillDir = path.dirname(skillFile);

        if (processedDirs.has(skillDir)) continue;
        processedDirs.add(skillDir);

        try {
          const content = await fs.readFile(skillFile, 'utf-8');
          const skillId = this.extractSkillId(skillFile, basePath);
          const description = this.parseSkillDescription(content);

          const config = await this.readSkillConfig(skillDir);

          skills.push({
            id: skillId,
            name: config?.name || this.guessNameFromPath(skillFile),
            description: description || config?.description || '',
            location: skillDir,
          });
        } catch (err) {
          console.warn(`[SkillsService] Failed to parse ${skillFile}:`, err);
        }
      }
    }

    this.skillsCache = { data: skills, expiry: Date.now() + CACHE_TTL_MS };
    return skills;
  }

  /**
   * Read a specific skill by ID
   */
  async readSkill(id: string): Promise<Skill | null> {
    const skills = await this.readSkills();
    return skills.find(s => s.id === id) || null;
  }

  /**
   * Generate permissions matrix (agents × skills)
   */
  async getPermissionsMatrix(): Promise<PermissionsMatrix> {
    const agents = await this.agentService.readAgents();
    const skills = await this.readSkills();

    const matrix: boolean[][] = [];

    for (const agent of agents) {
      const agentRow: boolean[] = [];
      for (const skill of skills) {
        const hasAccess = agent.skills?.includes(skill.id) || agent.skills?.includes(skill.name);
        agentRow.push(!!hasAccess);
      }
      matrix.push(agentRow);
    }

    return {
      agents,
      skills,
      matrix,
    };
  }

  /**
   * Parse SKILL.md to extract description
   */
  private parseSkillDescription(content: string): string {
    const lines = content.split('\n');
    let inDescription = false;
    const descriptionLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (i === 0 && line.startsWith('#')) {
        continue;
      }

      if (i > 0 && line === '') {
        inDescription = true;
        continue;
      }

      if (line.startsWith('##') || line.startsWith('#')) {
        break;
      }

      if (inDescription || (!line.startsWith('#') && !line.startsWith('```'))) {
        descriptionLines.push(line);
      }
    }

    return descriptionLines.join(' ').trim();
  }

  /**
   * Try to read skill.json config file
   */
  private async readSkillConfig(skillDir: string): Promise<SkillConfig | null> {
    const configPath = path.join(skillDir, 'skill.json');

    if (existsSync(configPath)) {
      try {
        const content = await fs.readFile(configPath, 'utf-8');
        return JSON.parse(content);
      } catch (err) {
        console.warn(`[SkillsService] Failed to parse ${configPath}:`, err);
      }
    }
    return null;
  }

  /**
   * Extract skill ID from SKILL.md path
   */
  private extractSkillId(skillFilePath: string, basePath: string): string {
    const relativePath = path.relative(basePath, skillFilePath);
    const parts = relativePath.split(path.sep);
    return parts[0] || 'unknown';
  }

  /**
   * Guess skill name from path
   */
  private guessNameFromPath(skillFilePath: string): string {
    const parts = skillFilePath.split(path.sep);
    for (let i = parts.length - 1; i >= 0; i--) {
      if (parts[i] === 'SKILL.md') {
        return parts[i - 1]?.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || 'Unknown Skill';
      }
    }
    return 'Unknown Skill';
  }
}
