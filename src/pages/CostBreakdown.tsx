import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/_shared/PageHeader";
import { Loading } from "@/components/_shared/Loading";
import {
  DollarSign,
  RefreshCw,
  AlertCircle,
  Cpu,
  Users,
  Wrench,
  Zap,
  TrendingUp,
  PieChart,
} from "lucide-react";
import { useProfile } from "@/app/profile-context";

interface CostStats {
  success: boolean;
  totalCost: number;
  totalTokens: number;
  activityCount: number;
  actorCosts: Record<string, { cost: number; tokens: number; actions: number }>;
  toolCosts: Record<string, { cost: number; count: number }>;
  generationSummary?: {
    totalCost: number;
    totalGenerations: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCacheReadTokens: number;
    byAgent: Record<
      string,
      { cost: number; generations: number; tokens: number }
    >;
    byModel: Record<
      string,
      { cost: number; generations: number; tokens: number }
    >;
  };
}

interface CostByActor {
  name: string;
  cost: number;
  tokens: number;
  actions: number;
}
interface CostByTool {
  name: string;
  cost: number;
  count: number;
}
interface CostByModel {
  name: string;
  fullName?: string;
  cost: number;
  generations: number;
  tokens: number;
}

function CostBar({
  value,
  max,
  color = "bg-primary",
}: {
  value: number;
  max: number;
  color?: string;
}) {
  const percentage = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
      <div
        className={`${color} h-full rounded-full transition-all duration-500`}
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
}

export default function CostBreakdown() {
  const { activeProfile, isSwitching } = useProfile();
  const [costStats, setCostStats] = useState<CostStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchCostStats = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const profileParam = activeProfile?.id
        ? `?profile=${encodeURIComponent(activeProfile.id)}`
        : "";
      const response = await fetch(`/api/cost-report${profileParam}`);
      if (!response.ok) throw new Error(`Failed: ${response.statusText}`);
      const data: CostStats = await response.json();
      if (data.success) setCostStats(data);
      else throw new Error("API returned unsuccessful response");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchCostStats();
  }, []);
  const handleRefresh = () => {
    setIsRefreshing(true);
    fetchCostStats();
  };
  const formatCost = (cost: number) => `$${cost.toFixed(4)}`;

  const getActorCosts = (): CostByActor[] => {
    if (!costStats?.actorCosts) return [];
    return Object.entries(costStats.actorCosts)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.cost - a.cost);
  };
  const getToolCosts = (): CostByTool[] => {
    if (!costStats?.toolCosts) return [];
    return Object.entries(costStats.toolCosts)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.cost - a.cost);
  };
  const getModelCosts = (): CostByModel[] => {
    if (!costStats?.generationSummary?.byModel) return [];
    return Object.entries(costStats.generationSummary.byModel)
      .map(([name, data]) => ({
        name: name.split("/").pop() || name,
        fullName: name,
        ...data,
      }))
      .sort((a, b) => b.cost - a.cost);
  };

  const totalCost =
    costStats?.generationSummary?.totalCost ?? costStats?.totalCost ?? 0;
  const totalTokens = costStats?.generationSummary
    ? costStats.generationSummary.totalInputTokens +
      costStats.generationSummary.totalOutputTokens
    : (costStats?.totalTokens ?? 0);
  const cacheHitRate = (() => {
    const cacheTokens = costStats?.generationSummary?.totalCacheReadTokens ?? 0;
    const inputTokens = costStats?.generationSummary?.totalInputTokens ?? 0;
    return inputTokens + cacheTokens === 0
      ? 0
      : (cacheTokens / (inputTokens + cacheTokens)) * 100;
  })();

  if (isLoading)
    return (
      <div className="space-y-6">
        <PageHeader title="Cost Breakdown" description="View cost statistics" />
        <Loading />
      </div>
    );
  if (error)
    return (
      <div className="space-y-6">
        <PageHeader title="Cost Breakdown" description="View cost statistics" />
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-3 py-6">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <div>
              <p className="font-medium text-destructive">Error</p>
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );

  const actorCosts = getActorCosts();
  const toolCosts = getToolCosts();
  const modelCosts = getModelCosts();
  const maxActorCost = actorCosts[0]?.cost ?? 0;
  const maxToolCost = toolCosts[0]?.cost ?? 0;
  const maxModelCost = modelCosts[0]?.cost ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <PageHeader
          title="Cost Breakdown"
          description="View cost statistics by actor, tool, and model"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={isRefreshing}
        >
          <RefreshCw
            className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="overflow-hidden border-l-4 border-l-emerald-500">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Cost
            </CardTitle>
            <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
              <DollarSign className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tracking-tight tabular-nums">
              {formatCost(totalCost)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {totalTokens.toLocaleString()} tokens
            </p>
          </CardContent>
        </Card>
        <Card className="overflow-hidden border-l-4 border-l-blue-500">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Activities
            </CardTitle>
            <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
              <Zap className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tracking-tight tabular-nums">
              {costStats?.activityCount ?? 0}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {costStats?.activityCount
                ? `${formatCost(totalCost / costStats.activityCount)} avg`
                : "No activities"}
            </p>
          </CardContent>
        </Card>
        <Card className="overflow-hidden border-l-4 border-l-purple-500">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              LLM Generations
            </CardTitle>
            <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30">
              <Cpu className="h-4 w-4 text-purple-600 dark:text-purple-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tracking-tight tabular-nums">
              {costStats?.generationSummary?.totalGenerations ?? 0}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Tracked generations
            </p>
          </CardContent>
        </Card>
        <Card className="overflow-hidden border-l-4 border-l-green-500">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Cache Hit Rate
            </CardTitle>
            <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30">
              <TrendingUp className="h-4 w-4 text-green-600 dark:text-green-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tracking-tight tabular-nums">
              {cacheHitRate.toFixed(1)}%
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {costStats?.generationSummary?.totalCacheReadTokens?.toLocaleString() ??
                0}{" "}
              cached tokens
            </p>
          </CardContent>
        </Card>
      </div>
      {modelCosts.length > 0 && (
        <Card className="shadow-sm">
          <CardHeader className="pb-4 border-b">
            <CardTitle className="flex items-center gap-2 text-lg">
              <PieChart className="h-5 w-5 text-primary" />
              Cost by Model
            </CardTitle>
            <CardDescription>Cost breakdown by LLM model</CardDescription>
          </CardHeader>
          <CardContent className="pt-4 px-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Model
                    </th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Gen
                    </th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Cost
                    </th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Distribution
                    </th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Tokens
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {modelCosts.map((model) => (
                    <tr
                      key={model.name}
                      className="border-b last:border-0 hover:bg-muted/40"
                    >
                      <td
                        className="py-3 px-4 text-sm font-medium"
                        title={model.fullName}
                      >
                        {model.name}
                      </td>
                      <td className="py-3 px-4 text-sm text-right tabular-nums">
                        {model.generations.toLocaleString()}
                      </td>
                      <td className="py-3 px-4 text-sm text-right font-medium tabular-nums">
                        {formatCost(model.cost)}
                      </td>
                      <td className="py-3 px-4">
                        <CostBar
                          value={model.cost}
                          max={maxModelCost}
                          color="bg-purple-500"
                        />
                      </td>
                      <td className="py-3 px-4 text-sm text-right tabular-nums">
                        {model.tokens.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
      {actorCosts.length > 0 && (
        <Card className="shadow-sm">
          <CardHeader className="pb-4 border-b">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Users className="h-5 w-5 text-primary" />
              Cost by Actor
            </CardTitle>
            <CardDescription>Cost breakdown by actor ID</CardDescription>
          </CardHeader>
          <CardContent className="pt-4 px-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Actor
                    </th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Actions
                    </th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Cost
                    </th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Distribution
                    </th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Tokens
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {actorCosts.map((actor) => (
                    <tr
                      key={actor.name}
                      className="border-b last:border-0 hover:bg-muted/40"
                    >
                      <td className="py-3 px-4 text-sm font-medium">
                        {actor.name}
                      </td>
                      <td className="py-3 px-4 text-sm text-right tabular-nums">
                        {actor.actions.toLocaleString()}
                      </td>
                      <td className="py-3 px-4 text-sm text-right font-medium tabular-nums">
                        {formatCost(actor.cost)}
                      </td>
                      <td className="py-3 px-4">
                        <CostBar
                          value={actor.cost}
                          max={maxActorCost}
                          color="bg-blue-500"
                        />
                      </td>
                      <td className="py-3 px-4 text-sm text-right tabular-nums">
                        {actor.tokens.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
      {toolCosts.length > 0 && (
        <Card className="shadow-sm">
          <CardHeader className="pb-4 border-b">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Wrench className="h-5 w-5 text-primary" />
              Cost by Tool
            </CardTitle>
            <CardDescription>Cost breakdown by tool name</CardDescription>
          </CardHeader>
          <CardContent className="pt-4 px-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Tool
                    </th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Calls
                    </th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Cost
                    </th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Distribution
                    </th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Cost/Call
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {toolCosts.map((tool) => (
                    <tr
                      key={tool.name}
                      className="border-b last:border-0 hover:bg-muted/40"
                    >
                      <td className="py-3 px-4 text-sm font-medium">
                        {tool.name}
                      </td>
                      <td className="py-3 px-4 text-sm text-right tabular-nums">
                        {tool.count.toLocaleString()}
                      </td>
                      <td className="py-3 px-4 text-sm text-right font-medium tabular-nums">
                        {formatCost(tool.cost)}
                      </td>
                      <td className="py-3 px-4">
                        <CostBar
                          value={tool.cost}
                          max={maxToolCost}
                          color="bg-emerald-500"
                        />
                      </td>
                      <td className="py-3 px-4 text-sm text-right tabular-nums">
                        ${(tool.cost / tool.count).toFixed(6)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
      {actorCosts.length === 0 &&
        toolCosts.length === 0 &&
        modelCosts.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center">
              <div className="flex flex-col items-center gap-2">
                <DollarSign className="h-12 w-12 text-muted-foreground/30" />
                <p className="text-muted-foreground">
                  No cost data available yet.
                </p>
                <p className="text-sm text-muted-foreground">
                  Costs will appear here as the system processes activities.
                </p>
              </div>
            </CardContent>
          </Card>
        )}
    </div>
  );
}
