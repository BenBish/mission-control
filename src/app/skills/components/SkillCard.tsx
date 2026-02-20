/**
 * SkillCard Component
 * Display skill information with associated agents
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MapPin, Users } from "lucide-react";
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
          <Badge variant="secondary" className="shrink-0 text-xs">
            {skill.category}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground line-clamp-2">
          {skill.description}
        </p>
        
        {skill.location && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <MapPin className="h-3.5 w-3.5" />
            <span>{skill.location}</span>
          </div>
        )}
        
        <div className="flex items-center gap-1.5 text-xs">
          <Users className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-muted-foreground">Available to:</span>
          <div className="flex flex-wrap gap-1">
            {skill.agentIds.map((agentId) => (
              <Badge key={agentId} variant="outline" className="text-xs py-0 h-5">
                {agentId}
              </Badge>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
