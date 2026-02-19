import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/_shared/PageHeader";
import { Loading } from "@/components/_shared/Loading";
import { DollarSign, RefreshCw, AlertCircle } from "lucide-react";

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
    byAgent: Record<string, { cost: number; generations: number; tokens: number }>;
    byModel: Record<string, { cost: number; generations: number; tokens: number }>;
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

export default function CostBreakdown() {
  const [costStats, setCostStats] = useState<CostStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchCostStats = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("http://localhost:3001/api/cost-report");
      if (!response.ok) {
        throw new Error(`Failed to fetch cost stats: ${response.statusText}`);
      }
      const data: CostStats = await response.json();
      if (data.success) {
        setCostStats(data);
      } else {
        throw new Error("API returned unsuccessful response");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error occurred");
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

  const formatCost = (cost: number) => {
    return `$${cost.toFixed(4)}`;
  };

  // Prepare data for tables
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

  const getTotalCost = () => {
    return costStats?.generationSummary?.totalCost ?? costStats?.totalCost ?? 0;
  };

  const getTotalTokens = () => {
    if (costStats?.generationSummary) {
      return costStats.generationSummary.totalInputTokens + costStats.generationSummary.totalOutputTokens;
    }
    return costStats?.totalTokens ?? 0;
  };

  const getCacheHitRate = () => {
    const cacheTokens = costStats?.generationSummary?.totalCacheReadTokens ?? 0;
    const inputTokens = costStats?.generationSummary?.totalInputTokens ?? 0;
    if (inputTokens + cacheTokens === 0) return 0;
    return (cacheTokens / (inputTokens + cacheTokens)) * 100;
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Cost Breakdown"
          description="View cost statistics by actor, tool, and model"
        />
        <Loading />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Cost Breakdown"
          description="View cost statistics by actor, tool, and model"
        />
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-3 py-6">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <div>
              <p className="font-medium text-destructive">Error loading cost data</p>
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const actorCosts = getActorCosts();
  const toolCosts = getToolCosts();
  const modelCosts = getModelCosts();
  const totalCost = getTotalCost();
  const totalTokens = getTotalTokens();
  const cacheHitRate = getCacheHitRate();

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
          <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Cost</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCost(totalCost)}</div>
            <p className="text-xs text-muted-foreground">
              {totalTokens.toLocaleString()} tokens
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Activities</CardTitle>
            <div className="h-4 w-4 rounded-full bg-primary/20" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{costStats?.activityCount ?? 0}</div>
            <p className="text-xs text-muted-foreground">
              {costStats?.activityCount
                ? `${formatCost(totalCost / costStats.activityCount)} avg`
                : "No activities"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">LLM Generations</CardTitle>
            <div className="h-4 w-4 rounded-full bg-primary/20" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {costStats?.generationSummary?.totalGenerations ?? 0}
            </div>
            <p className="text-xs text-muted-foreground">
              Tracked generations
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Cache Hit Rate</CardTitle>
            <div className="h-4 w-4 rounded-full bg-green-500/20" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{cacheHitRate.toFixed(1)}%</div>
            <p className="text-xs text-muted-foreground">
              {costStats?.generationSummary?.totalCacheReadTokens?.toLocaleString() ?? 0} cached tokens
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Model Costs Table */}
      {modelCosts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Cost by Model</CardTitle>
            <CardDescription>Cost breakdown by LLM model</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-2 text-sm font-medium text-muted-foreground">Model</th>
                    <th className="text-right py-3 px-2 text-sm font-medium text-muted-foreground">Generations</th>
                    <th className="text-right py-3 px-2 text-sm font-medium text-muted-foreground">Total Cost</th>
                    <th className="text-right py-3 px-2 text-sm font-medium text-muted-foreground">Tokens</th>
                    <th className="text-right py-3 px-2 text-sm font-medium text-muted-foreground">Cost/Gen</th>
                  </tr>
                </thead>
                <tbody>
                  {modelCosts.map((model) => (
                    <tr key={model.name} className="border-b last:border-0">
                      <td className="py-3 px-2 text-sm font-medium" title={model.fullName}>
                        {model.name}
                      </td>
                      <td className="py-3 px-2 text-sm text-right">{model.generations.toLocaleString()}</td>
                      <td className="py-3 px-2 text-sm text-right font-medium">{formatCost(model.cost)}</td>
                      <td className="py-3 px-2 text-sm text-right">{model.tokens.toLocaleString()}</td>
                      <td className="py-3 px-2 text-sm text-right text-muted-foreground">
                        ${(model.cost / model.generations).toFixed(6)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Actor Costs Table */}
      {actorCosts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Cost by Actor</CardTitle>
            <CardDescription>Cost breakdown by actor ID</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-2 text-sm font-medium text-muted-foreground">Actor</th>
                    <th className="text-right py-3 px-2 text-sm font-medium text-muted-foreground">Actions</th>
                    <th className="text-right py-3 px-2 text-sm font-medium text-muted-foreground">Total Cost</th>
                    <th className="text-right py-3 px-2 text-sm font-medium text-muted-foreground">Tokens</th>
                    <th className="text-right py-3 px-2 text-sm font-medium text-muted-foreground">Cost/Action</th>
                  </tr>
                </thead>
                <tbody>
                  {actorCosts.map((actor) => (
                    <tr key={actor.name} className="border-b last:border-0">
                      <td className="py-3 px-2 text-sm font-medium">{actor.name}</td>
                      <td className="py-3 px-2 text-sm text-right">{actor.actions.toLocaleString()}</td>
                      <td className="py-3 px-2 text-sm text-right font-medium">{formatCost(actor.cost)}</td>
                      <td className="py-3 px-2 text-sm text-right">{actor.tokens.toLocaleString()}</td>
                      <td className="py-3 px-2 text-sm text-right text-muted-foreground">
                        ${(actor.cost / actor.actions).toFixed(6)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tool Costs Table */}
      {toolCosts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Cost by Tool</CardTitle>
            <CardDescription>Cost breakdown by tool name</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-2 text-sm font-medium text-muted-foreground">Tool</th>
                    <th className="text-right py-3 px-2 text-sm font-medium text-muted-foreground">Calls</th>
                    <th className="text-right py-3 px-2 text-sm font-medium text-muted-foreground">Total Cost</th>
                    <th className="text-right py-3 px-2 text-sm font-medium text-muted-foreground">Cost/Call</th>
                  </tr>
                </thead>
                <tbody>
                  {toolCosts.map((tool) => (
                    <tr key={tool.name} className="border-b last:border-0">
                      <td className="py-3 px-2 text-sm font-medium">{tool.name}</td>
                      <td className="py-3 px-2 text-sm text-right">{tool.count.toLocaleString()}</td>
                      <td className="py-3 px-2 text-sm text-right font-medium">{formatCost(tool.cost)}</td>
                      <td className="py-3 px-2 text-sm text-right text-muted-foreground">
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

      {/* Empty State */}
      {actorCosts.length === 0 && toolCosts.length === 0 && modelCosts.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">No cost data available yet.</p>
            <p className="text-sm text-muted-foreground mt-1">
              Costs will appear here as the system processes activities.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
