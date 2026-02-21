/**
 * SkillsList Component
 * Grid layout with search
 */

import { useState, useMemo } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SkillCard } from "./SkillCard";
import type { Skill } from "@/types/skills";

interface SkillsListProps {
  skills: Skill[];
  isLoading?: boolean;
}

export function SkillsList({ skills, isLoading }: SkillsListProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredSkills = useMemo(() => {
    if (!searchQuery) return skills;
    const query = searchQuery.toLowerCase();
    return skills.filter(
      (skill) =>
        skill.name.toLowerCase().includes(query) ||
        skill.description.toLowerCase().includes(query)
    );
  }, [skills, searchQuery]);

  return (
    <div className="space-y-6">
      {/* Search */}
      <div className="flex gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search skills..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        {searchQuery && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSearchQuery("")}
            title="Clear search"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Results count */}
      {searchQuery && !isLoading && (
        <p className="text-sm text-muted-foreground">
          Showing {filteredSkills.length} of {skills.length} skills
        </p>
      )}

      {/* Skills Grid */}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              className="h-[180px] rounded-lg bg-muted animate-pulse"
            />
          ))}
        </div>
      ) : filteredSkills.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredSkills.map((skill) => (
            <SkillCard key={skill.id} skill={skill} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <p className="text-muted-foreground">
            {searchQuery ? "No skills match your search" : "No skills found"}
          </p>
          {searchQuery && (
            <Button
              variant="link"
              onClick={() => setSearchQuery("")}
              className="mt-2"
            >
              Clear search
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
