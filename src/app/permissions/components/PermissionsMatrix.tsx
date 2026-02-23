/**
 * PermissionsMatrix Component
 * Main matrix container that renders the agent × skill permissions grid.
 * Includes filters, summary stats, and a sticky-header scrollable table.
 */

import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { MatrixFilters } from "./MatrixFilters";
import { MatrixCell } from "./MatrixCell";
import type { PermissionsMatrixData } from "@/types/permissions";

interface PermissionsMatrixProps {
  data: PermissionsMatrixData;
}

export function PermissionsMatrix({ data }: PermissionsMatrixProps) {
  const navigate = useNavigate();
  const [agentFilter, setAgentFilter] = useState("all");
  const [skillFilter, setSkillFilter] = useState("all");

  // Compute filtered indices
  const filteredAgentIndices = useMemo(() => {
    if (agentFilter === "all") {
      return data.agents.map((_, i) => i);
    }
    const idx = data.agents.findIndex((a) => a.id === agentFilter);
    return idx >= 0 ? [idx] : [];
  }, [data.agents, agentFilter]);

  const filteredSkillIndices = useMemo(() => {
    if (skillFilter === "all") {
      return data.skills.map((_, i) => i);
    }
    const idx = data.skills.findIndex((s) => s.id === skillFilter);
    return idx >= 0 ? [idx] : [];
  }, [data.skills, skillFilter]);

  // Compute summary stats
  const totalGrants = useMemo(() => {
    let count = 0;
    for (const ai of filteredAgentIndices) {
      for (const si of filteredSkillIndices) {
        if (data.matrix[ai]?.[si]) {
          count++;
        }
      }
    }
    return count;
  }, [data.matrix, filteredAgentIndices, filteredSkillIndices]);

  const filteredAgents = filteredAgentIndices.map((i) => ({
    ...data.agents[i],
    _index: i,
  }));
  const filteredSkills = filteredSkillIndices.map((i) => ({
    ...data.skills[i],
    _index: i,
  }));

  // Empty state after filtering
  if (filteredAgents.length === 0 || filteredSkills.length === 0) {
    return (
      <div className="space-y-4">
        <MatrixFilters
          agents={data.agents}
          skills={data.skills}
          agentFilter={agentFilter}
          skillFilter={skillFilter}
          onAgentFilterChange={setAgentFilter}
          onSkillFilterChange={setSkillFilter}
        />
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              No results match your filters.
            </p>
            <button
              onClick={() => {
                setAgentFilter("all");
                setSkillFilter("all");
              }}
              className="mt-2 text-sm text-primary underline hover:no-underline"
            >
              Clear filters
            </button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card>
        <CardContent className="py-4">
          <MatrixFilters
            agents={data.agents}
            skills={data.skills}
            agentFilter={agentFilter}
            skillFilter={skillFilter}
            onAgentFilterChange={setAgentFilter}
            onSkillFilterChange={setSkillFilter}
          />
          {/* Summary stats */}
          <p className="mt-3 text-sm text-muted-foreground">
            {filteredAgents.length} agent{filteredAgents.length !== 1 ? "s" : ""}{" "}
            × {filteredSkills.length} skill{filteredSkills.length !== 1 ? "s" : ""}{" "}
            · {totalGrants} permission{totalGrants !== 1 ? "s" : ""} granted
          </p>
        </CardContent>
      </Card>

      {/* Matrix table */}
      <Card>
        <div className="overflow-auto max-h-[70vh] rounded-lg border">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {/* Corner cell */}
                <th
                  className="sticky left-0 top-0 z-30 bg-card border-b border-r px-4 py-3 text-left font-medium text-muted-foreground"
                  scope="col"
                >
                  Agent / Skill
                </th>
                {/* Skill column headers */}
                {filteredSkills.map((skill) => (
                  <th
                    key={skill.id}
                    className="sticky top-0 z-20 bg-card border-b border-r px-2 py-3 font-medium cursor-pointer hover:text-primary hover:underline"
                    scope="col"
                    onClick={() => navigate("/skills")}
                    title={skill.description || skill.name}
                  >
                    <span
                      className="block whitespace-nowrap overflow-hidden text-ellipsis max-w-[120px]"
                      style={{
                        writingMode: "vertical-lr",
                        transform: "rotate(180deg)",
                        maxHeight: "120px",
                      }}
                    >
                      {skill.name}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredAgents.map((agent, rowIdx) => (
                <tr
                  key={agent.id}
                  className={rowIdx % 2 === 1 ? "bg-muted/30" : ""}
                >
                  {/* Agent name (sticky left) */}
                  <th
                    className={`sticky left-0 z-10 border-b border-r px-4 py-2.5 text-left font-medium cursor-pointer hover:text-primary hover:underline max-w-[180px] truncate ${
                      rowIdx % 2 === 1 ? "bg-muted/30" : "bg-card"
                    }`}
                    scope="row"
                    onClick={() => navigate(`/agents/${agent.id}`)}
                    title={agent.name}
                    role="link"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        navigate(`/agents/${agent.id}`);
                      }
                    }}
                  >
                    {agent.name}
                  </th>
                  {/* Matrix cells */}
                  {filteredSkills.map((skill) => (
                    <MatrixCell
                      key={`${agent.id}-${skill.id}`}
                      hasAccess={data.matrix[agent._index]?.[skill._index] ?? false}
                      agentName={agent.name}
                      skillName={skill.name}
                    />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Legend */}
      <p className="text-xs text-muted-foreground">
        ✓ = access granted
      </p>
    </div>
  );
}
