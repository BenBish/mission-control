/**
 * Skills Service
 * Reads and parses skill SKILL.md files and generates permissions matrix
 */

import * as fs from "fs/promises";
import { existsSync } from "fs";
import * as os from "os";
import * as path from "path";
import { glob } from "glob";
import { Skill, SkillConfig, PermissionsMatrix } from "../types/agents.js";
import { AgentService } from "./agent-service.js";

// Resolved lazily so env vars set at runtime are respected.
// When SKILL_PATH is set, only that path is used.
function getSkillBasePaths(): string[] {
  if (process.env.SKILL_PATH) {
    return [process.env.SKILL_PATH];
  }

  // Try to find npm package installation path
  let npmSkillsPath = "";
  try {
    const npmPath = require.resolve("@orcateam/openclaw-skills");
    npmSkillsPath = path.dirname(npmPath);
  } catch {
    // npm package not found, that's ok - we'll use fallback paths
  }

  const paths = [
    path.join(os.homedir(), ".local/share/openclaw/skills"),
    "/usr/share/openclaw/skills",
    "/opt/openclaw/skills",
  ];

  // Insert npm package path if found
  if (npmSkillsPath) {
    paths.unshift(npmSkillsPath);
  }

  return paths;
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
  private lastCacheKey: string = "";

  constructor(agentService: AgentService) {
    this.agentService = agentService;
  }

  /**
   * Read all skills from the filesystem (cached with 30s TTL).
   * When `profileStateDir` is provided, skills from `<stateDir>/skills/`
   * are included (and take precedence over global skills with the same ID).
   */
  async readSkills(profileStateDir?: string): Promise<Skill[]> {
    const cacheKey = profileStateDir ?? "__global__";

    if (
      this.skillsCache &&
      Date.now() < this.skillsCache.expiry &&
      this.lastCacheKey === cacheKey
    ) {
      return this.skillsCache.data;
    }

    const skills: Skill[] = [];
    const processedDirs = new Set<string>();

    // Build search paths: profile-specific path first (higher priority)
    const basePaths = [...getSkillBasePaths()];
    if (profileStateDir) {
      const profileSkillsPath = path.join(profileStateDir, "skills");
      if (!basePaths.includes(profileSkillsPath)) {
        basePaths.unshift(profileSkillsPath);
      }
    }

    for (const basePath of basePaths) {
      if (!existsSync(basePath)) continue;

      const skillFiles = await glob("**/SKILL.md", {
        cwd: basePath,
        absolute: true,
        ignore: ["**/node_modules/**", "**/.git/**"],
      });

      for (const skillFile of skillFiles) {
        const skillDir = path.dirname(skillFile);

        if (processedDirs.has(skillDir)) continue;
        processedDirs.add(skillDir);

        try {
          const content = await fs.readFile(skillFile, "utf-8");
          const skillId = this.extractSkillId(skillFile, basePath);
          const description = this.parseSkillDescription(content);
          const category = this.parseSkillCategory(content);

          const config = await this.readSkillConfig(skillDir);

          skills.push({
            id: skillId,
            name: config?.name || this.guessNameFromPath(skillFile),
            description: description || config?.description || "",
            location: skillDir,
            category,
          });
        } catch (err) {
          console.warn(`[SkillsService] Failed to parse ${skillFile}:`, err);
        }
      }
    }

    this.skillsCache = { data: skills, expiry: Date.now() + CACHE_TTL_MS };
    this.lastCacheKey = cacheKey;
    return skills;
  }

  /**
   * Read a specific skill by ID
   */
  async readSkill(id: string, profileStateDir?: string): Promise<Skill | null> {
    const skills = await this.readSkills(profileStateDir);
    return skills.find((s) => s.id === id) || null;
  }

  /**
   * Generate permissions matrix (agents × skills)
   */
  async getPermissionsMatrix(
    profileId?: string,
    profileStateDir?: string,
  ): Promise<PermissionsMatrix> {
    const agents = await this.agentService.readAgents(profileId);
    const skills = await this.readSkills(profileStateDir);

    const matrix: boolean[][] = [];

    for (const agent of agents) {
      const agentRow: boolean[] = [];
      for (const skill of skills) {
        const hasAccess =
          agent.skills?.includes(skill.id) ||
          agent.skills?.includes(skill.name);
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
   * Parse SKILL.md to extract description, stripping YAML frontmatter
   * Falls back to YAML frontmatter description field if body parsing returns empty
   */
  private parseSkillDescription(content: string): string {
    // Strip YAML frontmatter block (--- ... ---) for body parsing
    const frontmatterRegex = /^---[\s\S]*?---\n/;
    const cleanContent = content.replace(frontmatterRegex, "");

    // Split and filter out empty lines to handle leading newlines after frontmatter strip
    const lines = cleanContent
      .split("\n")
      .filter((line) => line.trim().length > 0);

    const descriptionLines: string[] = [];
    let startIndex = 0;

    // Skip the first heading (if it exists)
    if (lines.length > 0 && lines[0].trim().startsWith("#")) {
      startIndex = 1;
    }

    // Extract description lines until we hit another heading
    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i].trim();

      // Stop at next heading
      if (line.startsWith("#")) {
        break;
      }

      // Skip code block markers
      if (!line.startsWith("```")) {
        descriptionLines.push(line);
      }
    }

    const bodyDescription = descriptionLines.join(" ").trim();
    if (bodyDescription.length > 0) {
      return bodyDescription;
    }

    // Fallback: extract description from YAML frontmatter
    const frontmatterMatch = content.match(
      /^---[\s\S]*?description:\s*["']?(.*?)["']?\s*\n/,
    );
    if (frontmatterMatch?.[1]) {
      return frontmatterMatch[1].trim();
    }

    return "";
  }

  /**
   * Parse category from YAML frontmatter
   */
  private parseSkillCategory(content: string): string | undefined {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) return undefined;

    const frontmatter = frontmatterMatch[1];
    const categoryMatch = frontmatter.match(/^category:\s*(.+)$/m);
    return categoryMatch ? categoryMatch[1].trim() : undefined;
  }

  /**
   * Try to read skill.json config file
   */
  private async readSkillConfig(skillDir: string): Promise<SkillConfig | null> {
    const configPath = path.join(skillDir, "skill.json");

    if (existsSync(configPath)) {
      try {
        const content = await fs.readFile(configPath, "utf-8");
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
    return parts[0] || "unknown";
  }

  /**
   * Guess skill name from path
   */
  private guessNameFromPath(skillFilePath: string): string {
    const parts = skillFilePath.split(path.sep);
    for (let i = parts.length - 1; i >= 0; i--) {
      if (parts[i] === "SKILL.md") {
        return (
          parts[i - 1]
            ?.replace(/-/g, " ")
            .replace(/\b\w/g, (c) => c.toUpperCase()) || "Unknown Skill"
        );
      }
    }
    return "Unknown Skill";
  }
}
