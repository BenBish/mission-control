/**
 * SkillsList Component
 * Grid layout with search and category filtering
 */

import { useState, useMemo } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SkillCard } from "./SkillCard";
import type { Skill } from "@/types/skills";

interface SkillsListProps {
  skills: Skill[];
  isLoading?: boolean;
}

export function SkillsList({ skills, isLoading }: SkillsListProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  // Extract unique categories from skills
  const categories = useMemo(() => {
    const cats = new Set<string>();
    skills.forEach((skill) => {
      if (skill.category) {
        cats.add(skill.category);
      }
    });
    return Array.from(cats).sort();
  }, [skills]);

  const filteredSkills = useMemo(() => {
    return skills.filter((skill) => {
      // Filter by category
      if (selectedCategory && skill.category !== selectedCategory) {
        return false;
      }

      // Filter by search query
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return (
          skill.name.toLowerCase().includes(query) ||
          skill.description.toLowerCase().includes(query)
        );
      }

      return true;
    });
  }, [skills, searchQuery, selectedCategory]);

  return (
    <div className="space-y-6">
      {/* Search and Category Filter */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:gap-2">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search skills..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Category Filter */}
        {categories.length > 0 && (
          <Select
            value={selectedCategory || "all"}
            onValueChange={(value) =>
              setSelectedCategory(value === "all" ? null : value)
            }
          >
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue placeholder="All categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {categories.map((cat) => (
                <SelectItem key={cat} value={cat}>
                  {cat}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Clear filters */}
        {(searchQuery || selectedCategory) && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setSearchQuery("");
              setSelectedCategory(null);
            }}
            title="Clear filters"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Results count */}
      {(searchQuery || selectedCategory) && !isLoading && (
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
            {searchQuery || selectedCategory
              ? "No skills match your filters"
              : "No skills found"}
          </p>
          {(searchQuery || selectedCategory) && (
            <Button
              variant="link"
              onClick={() => {
                setSearchQuery("");
                setSelectedCategory(null);
              }}
              className="mt-2"
            >
              Clear filters
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
