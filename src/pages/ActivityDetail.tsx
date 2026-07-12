import { createElement } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useActivity } from "@/lib/queries";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/_shared/PageHeader";
import { Loading } from "@/components/_shared/Loading";
import { Separator } from "@/components/ui/separator";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { actorIcon } from "@/lib/actor-display";
import {
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Clock,
  HelpCircle,
  DollarSign,
  Cpu,
  User,
  Wrench,
  Tag,
  FileJson,
  Terminal,
  Link2,
  Hash,
  Calendar,
  Timer,
  Layers,
} from "lucide-react";

function JsonDisplay({ data }: { data: unknown }) {
  const jsonString = JSON.stringify(data, null, 2);
  return (
    <SyntaxHighlighter
      language="json"
      style={oneDark}
      customStyle={{
        borderRadius: "0.5rem",
        fontSize: "0.75rem",
        margin: 0,
      }}
    >
      {jsonString}
    </SyntaxHighlighter>
  );
}

export default function ActivityDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: activity, isLoading, error } = useActivity(id);

  const formatTimestamp = (timestamp: string) =>
    new Date(timestamp).toLocaleString();
  const formatCost = (cost: number) => `$${cost.toFixed(4)}`;
  const getStatusIcon = (status: string) => {
    switch (status) {
      case "success":
        return (
          <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
        );
      case "failure":
        return <XCircle className="h-6 w-6 text-red-600 dark:text-red-400" />;
      case "pending":
        return <Clock className="h-6 w-6 text-amber-600 dark:text-amber-400" />;
      default:
        return (
          <HelpCircle className="h-6 w-6 text-blue-600 dark:text-blue-400" />
        );
    }
  };
  const getStatusBadge = (status: string) => {
    switch (status) {
      case "success":
        return (
          <Badge variant="success" className="capitalize text-sm">
            {status}
          </Badge>
        );
      case "failure":
        return (
          <Badge variant="destructive" className="capitalize text-sm">
            {status}
          </Badge>
        );
      case "pending":
        return (
          <Badge variant="warning" className="capitalize text-sm">
            {status}
          </Badge>
        );
      case "partial":
        return (
          <Badge variant="info" className="capitalize text-sm">
            {status}
          </Badge>
        );
      default:
        return (
          <Badge variant="secondary" className="capitalize text-sm">
            {status}
          </Badge>
        );
    }
  };

  if (isLoading)
    return (
      <div className="space-y-6">
        <PageHeader
          title="Activity Detail"
          description="View detailed information"
        />
        <Loading />
      </div>
    );
  if (error)
    return (
      <div className="space-y-6">
        <PageHeader
          title="Activity Detail"
          description="View detailed information"
        />
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-3 py-6">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <div>
              <p className="font-medium text-destructive">Error</p>
              <p className="text-sm text-muted-foreground">
                {error instanceof Error ? error.message : "Unknown error"}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  if (!activity)
    return (
      <div className="space-y-6">
        <PageHeader
          title="Activity Detail"
          description="View detailed information"
        />
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">Not found</p>
          </CardContent>
        </Card>
      </div>
    );

  const hasTokens = activity.totalTokens != null;

  return (
    <div className="space-y-6">
      <Button
        variant="outline"
        size="sm"
        onClick={() => navigate("/activities")}
        className="w-fit"
      >
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back
      </Button>
      <Card className="border-l-4 border-l-primary">
        <CardHeader className="pb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2 flex-1 min-w-0">
              <div className="flex items-center gap-3">
                {getStatusIcon(activity.status)}
                <CardTitle className="text-xl leading-tight">
                  {activity.description}
                </CardTitle>
              </div>
              <CardDescription className="flex items-center gap-2">
                <Hash className="h-3.5 w-3.5" />
                <span className="font-mono text-xs">{activity.id}</span>
              </CardDescription>
            </div>
            <div className="flex-shrink-0">
              {getStatusBadge(activity.status)}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 sm:grid-cols-3">
            {activity.costUsd != null && (
              <div className="flex items-center gap-3 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30">
                <div className="p-2 rounded-md bg-emerald-100 dark:bg-emerald-900/50">
                  <DollarSign className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Cost</p>
                  <p className="text-lg font-semibold tabular-nums">
                    {formatCost(activity.costUsd)}
                  </p>
                </div>
              </div>
            )}
            {hasTokens && (
              <div className="flex items-center gap-3 p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30">
                <div className="p-2 rounded-md bg-blue-100 dark:bg-blue-900/50">
                  <Cpu className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Tokens</p>
                  <p className="text-lg font-semibold tabular-nums">
                    {activity.totalTokens!.toLocaleString()}
                  </p>
                </div>
              </div>
            )}
            {activity.durationMs !== undefined && (
              <div className="flex items-center gap-3 p-3 rounded-lg bg-purple-50 dark:bg-purple-950/30">
                <div className="p-2 rounded-md bg-purple-100 dark:bg-purple-900/50">
                  <Timer className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Duration</p>
                  <p className="text-lg font-semibold tabular-nums">
                    {activity.durationMs}ms
                  </p>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <User className="h-4 w-4" />
              Actor
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Type</span>
                <Badge variant="outline" className="gap-1">
                  {createElement(actorIcon(activity.actor.type), {
                    className: "h-3 w-3",
                  })}
                  {activity.actor.type}
                </Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">ID</span>
                <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">
                  {activity.actor.id}
                </code>
              </div>
              {activity.actor.role && (
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Role</span>
                  <span className="text-sm">{activity.actor.role}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Wrench className="h-4 w-4" />
              Action
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Type</span>
                <Badge variant="secondary">{activity.actionType}</Badge>
              </div>
              {activity.toolName && (
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Tool</span>
                  <code className="text-xs font-mono">{activity.toolName}</code>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Timing
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Started</span>
                <span className="text-sm tabular-nums">
                  {formatTimestamp(activity.timestamp)}
                </span>
              </div>
              {activity.completedAt && (
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">
                    Completed
                  </span>
                  <span className="text-sm tabular-nums">
                    {formatTimestamp(activity.completedAt)}
                  </span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
        {hasTokens && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Layers className="h-4 w-4" />
                Token Usage
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Total</span>
                  <span className="text-sm font-medium tabular-nums">
                    {activity.totalTokens!.toLocaleString()}
                  </span>
                </div>
                {activity.inputTokens != null && (
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Input</span>
                    <span className="text-sm tabular-nums text-blue-600 dark:text-blue-400">
                      {activity.inputTokens.toLocaleString()}
                    </span>
                  </div>
                )}
                {activity.outputTokens != null && (
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">
                      Output
                    </span>
                    <span className="text-sm tabular-nums text-green-600 dark:text-green-400">
                      {activity.outputTokens.toLocaleString()}
                    </span>
                  </div>
                )}
                {(activity.cacheReadTokens || activity.cacheWriteTokens) && (
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">
                      Cache read / write
                    </span>
                    <span className="text-sm tabular-nums">
                      {(activity.cacheReadTokens ?? 0).toLocaleString()} /{" "}
                      {(activity.cacheWriteTokens ?? 0).toLocaleString()}
                    </span>
                  </div>
                )}
                {activity.model && (
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Model</span>
                    <code className="text-xs font-mono">{activity.model}</code>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Link2 className="h-4 w-4" />
              Session
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <code
              className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded block truncate"
              title={activity.sessionId}
            >
              {activity.sessionId}
            </code>
          </CardContent>
        </Card>
      </div>
      {activity.details && Object.keys(activity.details).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <FileJson className="h-5 w-5 text-primary" />
              Details
            </CardTitle>
          </CardHeader>
          <CardContent>
            <JsonDisplay data={activity.details} />
          </CardContent>
        </Card>
      )}
      {activity.result && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Terminal className="h-5 w-5 text-primary" />
              Result
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Success:</span>
                <Badge
                  variant={activity.result.success ? "success" : "destructive"}
                >
                  {activity.result.success ? "Yes" : "No"}
                </Badge>
              </div>
              {activity.result.exitCode !== undefined && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    Exit Code:
                  </span>
                  <code className="text-sm font-mono bg-muted px-1.5 py-0.5 rounded">
                    {activity.result.exitCode}
                  </code>
                </div>
              )}
            </div>
            <Separator />
            {activity.result.output && (
              <div>
                <p className="text-sm font-medium mb-2">Output:</p>
                <pre className="rounded-md bg-muted p-4 text-xs overflow-x-auto max-h-60 font-mono">
                  {activity.result.output}
                </pre>
              </div>
            )}
            {activity.result.error && (
              <div>
                <p className="text-sm font-medium mb-2 text-red-600">Error:</p>
                <pre className="rounded-md bg-red-50 dark:bg-red-950 p-4 text-xs overflow-x-auto text-red-600 dark:text-red-400 font-mono">
                  {activity.result.error}
                </pre>
              </div>
            )}
          </CardContent>
        </Card>
      )}
      {activity.tags && activity.tags.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Tag className="h-5 w-5 text-primary" />
              Tags
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {activity.tags.map((tag) => (
                <Badge
                  key={tag}
                  variant="outline"
                  className="text-sm py-1 px-3"
                >
                  {tag}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
