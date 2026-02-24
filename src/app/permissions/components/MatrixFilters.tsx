/**
 * MatrixFilters Component
 * Agent and skill filter dropdowns for the permissions matrix.
 */

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { PermissionAgent, PermissionSkill } from "@/types/permissions";

interface MatrixFiltersProps {
  agents: PermissionAgent[];
  skills: PermissionSkill[];
  agentFilter: string;
  skillFilter: string;
  onAgentFilterChange: (value: string) => void;
  onSkillFilterChange: (value: string) => void;
}

export function MatrixFilters({
  agents,
  skills,
  agentFilter,
  skillFilter,
  onAgentFilterChange,
  onSkillFilterChange,
}: MatrixFiltersProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium text-muted-foreground whitespace-nowrap">
          Agent:
        </label>
        <Select value={agentFilter} onValueChange={onAgentFilterChange}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Agents" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Agents</SelectItem>
            {agents.map((agent) => (
              <SelectItem key={agent.id} value={agent.id}>
                {agent.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2">
        <label className="text-sm font-medium text-muted-foreground whitespace-nowrap">
          Skill:
        </label>
        <Select value={skillFilter} onValueChange={onSkillFilterChange}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Skills" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Skills</SelectItem>
            {skills.map((skill) => (
              <SelectItem key={skill.id} value={skill.id}>
                {skill.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
