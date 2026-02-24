/**
 * SkillCard Component
 * Display skill information with agent access badges and category
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Skill } from "@/types/skills";

interface SkillCardProps {
  skill: Skill;
}

export function SkillCard({ skill }: SkillCardProps) {
  return (
    <Card className="hover:shadow-md transition-shadow duration-200">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base font-semibold leading-tight">
            {skill.name}
          </CardTitle>
          {skill.category && (
            <span className="text-xs bg-muted text-muted-foreground px-2 py-1 rounded whitespace-nowrap">
              {skill.category}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground line-clamp-2">
          {skill.description}
        </p>

        {/* Agent badges */}
        {skill.agents && skill.agents.length > 0 && (
          <div className="pt-2 border-t">
            <p className="text-xs font-medium text-muted-foreground mb-2">
              Available to:
            </p>
            <div className="flex flex-wrap gap-1">
              {skill.agents.map((agent) => (
                <span
                  key={agent.id}
                  className="text-xs bg-primary/10 text-primary px-2 py-1 rounded"
                >
                  {agent.name}
                </span>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
