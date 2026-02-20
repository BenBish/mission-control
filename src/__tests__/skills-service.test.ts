/**
 * Skills Service Tests
 * Verifies skill reading and permissions matrix functionality
 */

import { SkillsService } from '../services/skills-service.js';
import { AgentService } from '../services/agent-service.js';

describe('SkillsService', () => {
  let skillsService: SkillsService;
  let agentService: AgentService;

  beforeAll(() => {
    agentService = new AgentService();
    skillsService = new SkillsService(agentService);
  });

  describe('readSkills', () => {
    test('should return empty array when no skills exist', async () => {
      const skills = await skillsService.readSkills();
      expect(Array.isArray(skills)).toBe(true);
    });
  });

  describe('readSkill', () => {
    test('should return null for non-existent skill', async () => {
      const skill = await skillsService.readSkill('nonexistent-skill');
      expect(skill).toBeNull();
    });
  });

  describe('getPermissionsMatrix', () => {
    test('should return matrix with empty arrays when no data', async () => {
      const matrix = await skillsService.getPermissionsMatrix();
      
      expect(matrix).toHaveProperty('agents');
      expect(matrix).toHaveProperty('skills');
      expect(matrix).toHaveProperty('matrix');
      expect(Array.isArray(matrix.agents)).toBe(true);
      expect(Array.isArray(matrix.skills)).toBe(true);
      expect(Array.isArray(matrix.matrix)).toBe(true);
    });

    test('should have correct matrix dimensions', async () => {
      const matrix = await skillsService.getPermissionsMatrix();
      
      // Matrix should have agents.length rows
      expect(matrix.matrix.length).toBe(matrix.agents.length);
      
      // Each row should have skills.length columns
      for (const row of matrix.matrix) {
        expect(row.length).toBe(matrix.skills.length);
      }
    });
  });
});
