import { useParams, useNavigate } from "react-router-dom";
import { useAgent } from "../hooks/useAgents";
import { useAgentActivity } from "../hooks/useAgentActivity";
import { PageHeader } from "@/components/_shared/PageHeader";
import { Loading } from "@/components/_shared/Loading";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { SOULMarkdownViewer } from "../components/SOULMarkdownViewer";
import { AgentActivityFeed } from "../components/AgentActivityFeed";
import { AgentConfigPanel } from "../components/AgentConfigPanel";
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  Clock,
  DollarSign,
  Hash,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatLastActive } from "@/lib/date-utils";
import { useProfile } from "@/app/profile-context";

export default function AgentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { activeProfile, isSwitching } = useProfile();
  const { agent, isLoading, error } = useAgent(id || "", activeProfile?.id);
  const {
    activities,
    isLoading: activitiesLoading,
    error: activitiesError,
    isSubscribed,
    refetch: refetchActivities,
  } = useAgentActivity(id || null, activeProfile?.id);

  if (!id) {
    return (
      <div className="space-y-6">
        <PageHeader title="Agent" description="Agent details" />
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-3 py-6">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <p className="font-medium text-destructive">Invalid agent ID</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading || isSwitching) {
    return (
      <div className="space-y-6">
        <PageHeader title="Agent" description="Loading agent details..." />
        <Loading />
      </div>
    );
  }

  if (error || !agent) {
    return (
      <div className="space-y-6">
        <PageHeader title="Agent" description="Agent details" />
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-3 py-6">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <div>
              <p className="font-medium text-destructive">
                Error loading agent
              </p>
              <p className="text-sm text-muted-foreground">
                {error || "Agent not found"}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

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

  const getStatusBadge = (status: typeof agent.status) => {
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          className="gap-2"
          onClick={() => navigate("/agents")}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Agents
        </Button>
      </div>

      {/* Agent Header */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 dark:bg-primary/20">
                <Bot className="h-6 w-6 text-primary" />
              </div>
              <div>
                <CardTitle className="text-2xl">{agent.name}</CardTitle>
                <div className="mt-2 flex items-center gap-2">
                  <Badge
                    variant={
                      agent.role === "orchestrator" ? "default" : "secondary"
                    }
                  >
                    {agent.role}
                  </Badge>
                  {getStatusBadge(agent.status)}
                </div>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Model</p>
              <p className="font-mono text-sm font-medium">{agent.model}</p>
            </div>
            <div className="space-y-1">
              <p className="flex items-center gap-1 text-sm text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                Last Active
              </p>
              <p className="text-sm font-medium">
                {formatLastActive(agent.lastActive)}
              </p>
            </div>
            <div className="space-y-1">
              <p className="flex items-center gap-1 text-sm text-muted-foreground">
                <Hash className="h-3.5 w-3.5" />
                Sessions
              </p>
              <p className="text-sm font-medium">{agent.sessionCount}</p>
            </div>
            <div className="space-y-1">
              <p className="flex items-center gap-1 text-sm text-muted-foreground">
                <DollarSign className="h-3.5 w-3.5" />
                Total Cost
              </p>
              <p className="text-sm font-medium">
                {formatCost(agent.totalCost)}
              </p>
            </div>
          </div>
          <div className="mt-4 border-t pt-4">
            <div className="flex items-center gap-2">
              <Zap className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                <span className="font-medium">
                  {formatTokens(agent.totalTokens)}
                </span>{" "}
                tokens total
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="activity" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="activity">Activity Feed</TabsTrigger>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="soul" disabled={!agent.soulMarkdown}>
            SOUL.md
          </TabsTrigger>
          <TabsTrigger value="config" disabled={!agent.config}>
            Config
          </TabsTrigger>
        </TabsList>

        {/* Activity Feed Tab */}
        <TabsContent value="activity">
          <AgentActivityFeed
            activities={activities}
            isLoading={activitiesLoading}
            error={activitiesError}
            isSubscribed={isSubscribed}
            onRefresh={refetchActivities}
            agentName={agent?.name}
          />
        </TabsContent>

        {/* Overview Tab */}
        <TabsContent value="overview">
          <Card>
            <CardHeader>
              <CardTitle>Agent Overview</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4">
                <div>
                  <h3 className="text-sm font-semibold text-muted-foreground">
                    Agent ID
                  </h3>
                  <p className="font-mono text-sm">{agent.id}</p>
                </div>
                {agent.config?.identity && (
                  <div>
                    <h3 className="text-sm font-semibold text-muted-foreground">
                      Identity
                    </h3>
                    <p className="text-sm">
                      {agent.config.identity.emoji} {agent.config.identity.name}
                    </p>
                  </div>
                )}
                {agent.config?.model && (
                  <div>
                    <h3 className="text-sm font-semibold text-muted-foreground">
                      Configured Model
                    </h3>
                    <p className="font-mono text-sm">{agent.config.model}</p>
                  </div>
                )}
                {agent.config?.workspace && (
                  <div>
                    <h3 className="text-sm font-semibold text-muted-foreground">
                      Workspace
                    </h3>
                    <p className="font-mono text-xs text-muted-foreground break-all">
                      {agent.config.workspace}
                    </p>
                  </div>
                )}
                {agent.config?.gitConfig && (
                  <div>
                    <h3 className="text-sm font-semibold text-muted-foreground">
                      Git Configuration
                    </h3>
                    <div className="space-y-1 text-sm">
                      {agent.config.gitConfig.author && (
                        <p>
                          <span className="text-muted-foreground">Author:</span>{" "}
                          <span className="font-mono">
                            {agent.config.gitConfig.author}
                          </span>
                        </p>
                      )}
                      {agent.config.gitConfig.email && (
                        <p>
                          <span className="text-muted-foreground">Email:</span>{" "}
                          <span className="font-mono">
                            {agent.config.gitConfig.email}
                          </span>
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
          {agent.skills && agent.skills.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Skills</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {agent.skills.map((skill) => (
                  <Badge key={skill} variant="secondary">
                    {skill}
                  </Badge>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* SOUL.md Tab */}
        <TabsContent value="soul">
          <Card>
            <CardHeader>
              <CardTitle>SOUL.md</CardTitle>
            </CardHeader>
            <CardContent className="max-h-[600px] overflow-y-auto">
              {agent.soulMarkdown ? (
                <SOULMarkdownViewer markdown={agent.soulMarkdown} />
              ) : (
                <p className="text-muted-foreground">No SOUL.md file found</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Configuration Tab */}
        <TabsContent value="config">
          {agent.config ? (
            <AgentConfigPanel agent={agent} profileId={activeProfile?.id} />
          ) : (
            <Card>
              <CardContent className="py-6">
                <p className="text-muted-foreground">
                  No configuration data available
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
