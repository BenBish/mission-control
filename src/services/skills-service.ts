/**
 * Skills Service
 * Reads and parses skill SKILL.md files and generates permissions matrix
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { glob } from 'glob';
import { Skill, SkillConfig, PermissionsMatrix, Agent } from '../types/agents.js';
import { AgentService } from './agent-service.js';

// Possible skill locations
const SKILL_BASE_PATHS = [
  process.env.SKILL_PATH || path.join(os.homedir(), '.local/share/openclaw/skills'),
  '/usr/share/openclaw/skills',
  '/opt/openclaw/skills',
];

export class SkillsService {
  private agentService: AgentService;

  constructor(agentService: AgentService) {
    this.agentService = agentService;
  }

  /**
   * Read all skills from the filesystem
   */
  async readSkills(): Promise<Skill[]> {
    const skills: Skill[] = [];
    const processedDirs = new Set<string>();

    for (const basePath of SKILL_BASE_PATHS) {
      if (!fs.existsSync(basePath)) continue;

      // Look for SKILL.md files
      const skillFiles = await glob('**/SKILL.md', { cwd: basePath, absolute: true });
      
      for (const skillFile of skillFiles) {
        const skillDir = path.dirname(skillFile);
        
        // Avoid processing the same skill twice
        if (processedDirs.has(skillDir)) continue;
        processedDirs.add(skillDir);

        try {
          const content = fs.readFileSync(skillFile, 'utf-8');
          const skillId = this.extractSkillId(skillFile, basePath);
          const description = this.parseSkillDescription(content);
          
          // Try to read skill.json for additional config
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

    // Build matrix: matrix[agentIndex][skillIndex] = true if agent has access
    const matrix: boolean[][] = [];

    for (const agent of agents) {
      const agentRow: boolean[] = [];
      for (const skill of skills) {
        // Agent has access only if allowedSkills explicitly includes this skill's ID or name
        // Empty or undefined skills = NO access (explicit denial)
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
    // Look for description in first paragraph after title
    const lines = content.split('\n');
    let inDescription = false;
    const descriptionLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Skip title (first line with #)
      if (i === 0 && line.startsWith('#')) {
        continue;
      }
      
      // Start collecting description after blank line following title
      if (i > 0 && line === '') {
        inDescription = true;
        continue;
      }
      
      // Stop at next heading
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
    
    if (fs.existsSync(configPath)) {
      try {
        const content = fs.readFileSync(configPath, 'utf-8');
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
    
    // Skill ID is the directory containing SKILL.md
    // e.g., github/SKILL.md -> github
    return parts[0] || 'unknown';
  }

  /**
   * Guess skill name from path
   */
  private guessNameFromPath(skillFilePath: string): string {
    const parts = skillFilePath.split(path.sep);
    // Find the skill directory name
    for (let i = parts.length - 1; i >= 0; i--) {
      if (parts[i] === 'SKILL.md') {
        return parts[i - 1]?.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || 'Unknown Skill';
      }
    }
    return 'Unknown Skill';
  }
}
