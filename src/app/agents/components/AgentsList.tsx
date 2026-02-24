import { useState, useMemo } from "react";
import { AgentCard } from "./AgentCard";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, SlidersHorizontal, Users } from "lucide-react";
import type { Agent } from "@/types/agent";
import { compareDates } from "@/lib/date-utils";

interface AgentsListProps {
  agents: Agent[];
}

type SortOption = "name" | "role" | "lastActive";
type SortDirection = "asc" | "desc";

export function AgentsList({ agents }: AgentsListProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [modelFilter, setModelFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<SortOption>("lastActive");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  // Get unique values for filters
  const uniqueRoles = useMemo(
    () => Array.from(new Set(agents.map((a) => a.role))),
    [agents],
  );

  const uniqueModels = useMemo(
    () =>
      Array.from(
        new Set(agents.map((a) => a.model).filter((m) => m !== "unknown")),
      ),
    [agents],
  );

  // Filter and sort agents
  const filteredAgents = useMemo(() => {
    let result = [...agents];

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter((agent) =>
        agent.name.toLowerCase().includes(query),
      );
    }

    // Role filter
    if (roleFilter !== "all") {
      result = result.filter((agent) => agent.role === roleFilter);
    }

    // Model filter
    if (modelFilter !== "all") {
      result = result.filter((agent) => agent.model === modelFilter);
    }

    // Status filter
    if (statusFilter !== "all") {
      result = result.filter((agent) => agent.status === statusFilter);
    }

    // Sort
    result.sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case "name":
          comparison = a.name.localeCompare(b.name);
          break;
        case "role":
          comparison = a.role.localeCompare(b.role);
          break;
        case "lastActive":
          comparison = compareDates(a.lastActive, b.lastActive);
          break;
      }

      return sortDirection === "asc" ? comparison : -comparison;
    });

    return result;
  }, [
    agents,
    searchQuery,
    roleFilter,
    modelFilter,
    statusFilter,
    sortBy,
    sortDirection,
  ]);

  const hasFilters =
    searchQuery ||
    roleFilter !== "all" ||
    modelFilter !== "all" ||
    statusFilter !== "all";

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card className="shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-col gap-4">
            {/* Search Row */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search agents by name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            {/* Filter Row */}
            <div className="flex flex-wrap gap-2 items-center">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Filters:</span>
              </div>

              <Select value={roleFilter} onValueChange={setRoleFilter}>
                <SelectTrigger className="w-[130px] h-9">
                  <SelectValue placeholder="Role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Roles</SelectItem>
                  {uniqueRoles.map((role) => (
                    <SelectItem key={role} value={role}>
                      {role}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={modelFilter} onValueChange={setModelFilter}>
                <SelectTrigger className="w-[150px] h-9">
                  <SelectValue placeholder="Model" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Models</SelectItem>
                  {uniqueModels.map((model) => (
                    <SelectItem key={model} value={model}>
                      {model}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[130px] h-9">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="online">Online</SelectItem>
                  <SelectItem value="busy">Busy</SelectItem>
                  <SelectItem value="idle">Idle</SelectItem>
                  <SelectItem value="offline">Offline</SelectItem>
                </SelectContent>
              </Select>

              {/* Sort */}
              <div className="flex items-center gap-2 ml-auto">
                <span className="text-sm text-muted-foreground">Sort:</span>
                <Select
                  value={sortBy}
                  onValueChange={(value) => setSortBy(value as SortOption)}
                >
                  <SelectTrigger className="w-[130px] h-9">
                    <SelectValue placeholder="Sort by" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="name">Name</SelectItem>
                    <SelectItem value="role">Role</SelectItem>
                    <SelectItem value="lastActive">Last Active</SelectItem>
                  </SelectContent>
                </Select>

                <Select
                  value={sortDirection}
                  onValueChange={(value) =>
                    setSortDirection(value as SortDirection)
                  }
                >
                  <SelectTrigger className="w-[100px] h-9">
                    <SelectValue placeholder="Direction" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="asc">Ascending</SelectItem>
                    <SelectItem value="desc">Descending</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Results count */}
            {hasFilters && (
              <div className="flex items-center gap-2 pt-2 border-t">
                <Badge variant="outline" className="font-normal">
                  {filteredAgents.length} of {agents.length} agents
                </Badge>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Agents Grid */}
      {filteredAgents.length === 0 ? (
        <Card className="shadow-sm">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Users className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <p className="text-muted-foreground">
              {hasFilters ? "No agents match your filters" : "No agents found"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredAgents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
        </div>
      )}
    </div>
  );
}
