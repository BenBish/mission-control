import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Agent } from "@/types/agent";
import { Bot, Clock, Zap, DollarSign, Hash } from "lucide-react";

interface AgentCardProps {
  agent: Agent;
}

export function AgentCard({ agent }: AgentCardProps) {
  const navigate = useNavigate();

  const handleClick = () => {
    navigate(`/agents/${agent.id}`);
  };

  const formatLastActive = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const formatCost = (cost: number) => {
    if (cost === 0) return "$0.00";
    if (cost < 0.01) return `$${cost.toFixed(4)}`;
    return `$${cost.toFixed(2)}`;
  };

  const formatTokens = (tokens: number) => {
    if (tokens === 0) return "0";
    if (tokens < 1000) return tokens.toString();
    if (tokens < 1000000) return `${(tokens / 1000).toFixed(1)}K`;
    return `${(tokens / 1000000).toFixed(1)}M`;
  };

  const getStatusBadge = (status: Agent["status"]) => {
    switch (status) {
      case "online":
        return (
          <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800">
            <span className="h-2 w-2 rounded-full bg-emerald-500 mr-1.5 animate-pulse" />
            Online
          </Badge>
        );
      case "busy":
        return (
          <Badge className="bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800">
            <span className="h-2 w-2 rounded-full bg-amber-500 mr-1.5" />
            Busy
          </Badge>
        );
      case "idle":
        return (
          <Badge className="bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-800">
            <span className="h-2 w-2 rounded-full bg-blue-500 mr-1.5" />
            Idle
          </Badge>
        );
      case "offline":
        return (
          <Badge variant="outline" className="text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-muted-foreground mr-1.5" />
            Offline
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getRoleBadgeVariant = (role: string): "default" | "secondary" | "outline" => {
    switch (role) {
      case "orchestrator":
        return "default";
      case "subagent":
        return "secondary";
      default:
        return "outline";
    }
  };

  return (
    <Card
      className="cursor-pointer transition-all duration-200 hover:shadow-md hover:border-primary/30 dark:hover:border-primary/50 group"
      onClick={handleClick}
    >
      <CardHeader className="pb-3">
        <div className="flex gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 dark:bg-primary/20 group-hover:bg-primary/20 dark:group-hover:bg-primary/30 transition-colors">
            <Bot className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between">
              <CardTitle className="text-base font-semibold group-hover:text-primary transition-colors">
                {agent.name}
              </CardTitle>
              <div className="shrink-0">{getStatusBadge(agent.status)}</div>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {agent.role.charAt(0).toUpperCase() + agent.role.slice(1)}
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Zap className="h-3.5 w-3.5" />
            <span className="truncate font-mono text-xs">{agent.model}</span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            <span className="text-xs">{formatLastActive(agent.lastActive)}</span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <Hash className="h-3.5 w-3.5" />
            <span className="text-xs">{agent.sessionCount} sessions</span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <DollarSign className="h-3.5 w-3.5" />
            <span className="text-xs">{formatCost(agent.totalCost)}</span>
          </div>
        </div>
        <div className="mt-3 pt-3 border-t">
          <div className="text-xs text-muted-foreground">
            <span className="font-medium">{formatTokens(agent.totalTokens)}</span> tokens total
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
