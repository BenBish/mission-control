/**
 * Agent & Skills Routes Tests
 * Verifies API endpoints for agents and skills
 */

import { AgentService } from "../services/agent-service.js";
import { SkillsService } from "../services/skills-service.js";

describe("Agents API Routes", () => {
  describe("Agent service integration", () => {
    test("should create agent service", () => {
      const agentService = new AgentService();

      expect(agentService).toBeDefined();
      expect(typeof agentService.readAgents).toBe("function");
      expect(typeof agentService.readAgent).toBe("function");
      expect(typeof agentService.getAgentActivity).toBe("function");
    });

    test("should create skills service with agent service", () => {
      const agentService = new AgentService();
      const skillsService = new SkillsService(agentService);

      expect(skillsService).toBeDefined();
      expect(typeof skillsService.readSkills).toBe("function");
      expect(typeof skillsService.getPermissionsMatrix).toBe("function");
    });
  });

  describe("Route handler definitions", () => {
    test("should have all required AgentService methods", () => {
      const agentServiceProto = AgentService.prototype;

      // AgentService methods
      expect(typeof agentServiceProto.readAgents).toBe("function");
      expect(typeof agentServiceProto.readAgent).toBe("function");
      expect(typeof agentServiceProto.readAgentSoul).toBe("function");
      expect(typeof agentServiceProto.readAgentFullConfig).toBe("function");
      expect(typeof agentServiceProto.getAgentActivity).toBe("function");
      expect(typeof agentServiceProto.getAgentSkills).toBe("function");
    });

    test("should have all required SkillsService methods", () => {
      const skillsServiceProto = SkillsService.prototype;

      // SkillsService methods
      expect(typeof skillsServiceProto.readSkills).toBe("function");
      expect(typeof skillsServiceProto.readSkill).toBe("function");
      expect(typeof skillsServiceProto.getPermissionsMatrix).toBe("function");
    });
  });

  describe("Error handling", () => {
    test("should handle database errors gracefully", async () => {
      // Create service without database to test error handling
      const agentService = new AgentService();

      // Should return empty results, not throw
      const agents = await agentService.readAgents();
      expect(Array.isArray(agents)).toBe(true);

      const activities = await agentService.getAgentActivity("test");
      expect(Array.isArray(activities)).toBe(true);
    });
  });
});
