/**
 * SkillsList Component
 * Grid layout with filtering and search
 */

import { useState, useMemo } from "react";
import { Search, Filter, X } from "lucide-react";
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
  categories: string[];
  isLoading?: boolean;
}

export function SkillsList({ skills, categories, isLoading }: SkillsListProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  const filteredSkills = useMemo(() => {
    return skills.filter((skill) => {
      const matchesSearch =
        !searchQuery ||
        skill.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        skill.description.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesCategory =
        selectedCategory === "all" ||
        skill.category === selectedCategory;
      
      return matchesSearch && matchesCategory;
    });
  }, [skills, searchQuery, selectedCategory]);

  const clearFilters = () => {
    setSearchQuery("");
    setSelectedCategory("all");
  };

  const hasFilters = searchQuery || selectedCategory !== "all";

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search skills..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        
        <div className="flex gap-2">
          <Select
            value={selectedCategory}
            onValueChange={setSelectedCategory}
          >
            <SelectTrigger className="w-[180px]">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {categories.map((category) => (
                <SelectItem key={category} value={category}>
                  {category}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          
          {hasFilters && (
            <Button
              variant="ghost"
              size="icon"
              onClick={clearFilters}
              title="Clear filters"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Results count */}
      {hasFilters && !isLoading && (
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
            {hasFilters
              ? "No skills match your filters"
              : "No skills found"}
          </p>
          {hasFilters && (
            <Button
              variant="link"
              onClick={clearFilters}
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
