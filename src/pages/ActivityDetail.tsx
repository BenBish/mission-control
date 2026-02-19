import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/_shared/PageHeader";
import { Loading } from "@/components/_shared/Loading";
import { Separator } from "@/components/ui/separator";
import type { Activity } from "@/types/activity";
import { ArrowLeft, AlertCircle, CheckCircle2, XCircle, Clock, HelpCircle } from "lucide-react";

interface ActivityResponse {
  success: boolean;
  activity: Activity;
}

export default function ActivityDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [activity, setActivity] = useState<Activity | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchActivity = async () => {
      if (!id) {
        setError("No activity ID provided");
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch(`http://localhost:3001/api/activities/${id}`);
        if (!response.ok) {
          if (response.status === 404) {
            throw new Error("Activity not found");
          }
          throw new Error(`Failed to fetch activity: ${response.statusText}`);
        }
        const data: ActivityResponse = await response.json();
        if (data.success) {
          setActivity(data.activity);
        } else {
          throw new Error("API returned unsuccessful response");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error occurred");
      } finally {
        setIsLoading(false);
      }
    };

    fetchActivity();
  }, [id]);

  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleString();
  };

  const formatJson = (obj: unknown) => {
    return JSON.stringify(obj, null, 2);
  };

  const formatCost = (cost?: { usd: number }) => {
    if (!cost) return "$0.0000";
    return `$${cost.usd.toFixed(4)}`;
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "success":
        return <CheckCircle2 className="h-5 w-5 text-green-600" />;
      case "failure":
        return <XCircle className="h-5 w-5 text-red-600" />;
      case "pending":
        return <Clock className="h-5 w-5 text-amber-600" />;
      default:
        return <HelpCircle className="h-5 w-5 text-blue-600" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "success":
        return "text-green-600";
      case "failure":
        return "text-red-600";
      case "pending":
        return "text-amber-600";
      case "partial":
        return "text-blue-600";
      default:
        return "text-gray-600";
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Activity Detail"
          description="View detailed information about an activity"
        />
        <Loading />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Activity Detail"
          description="View detailed information about an activity"
        />
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-3 py-6">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <div>
              <p className="font-medium text-destructive">Error loading activity</p>
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
          </CardContent>
        </Card>
        <Button variant="outline" onClick={() => navigate("/activities")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Activities
        </Button>
      </div>
    );
  }

  if (!activity) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Activity Detail"
          description="View detailed information about an activity"
        />
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">Activity not found</p>
          </CardContent>
        </Card>
        <Button variant="outline" onClick={() => navigate("/activities")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Activities
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="sm" onClick={() => navigate("/activities")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
      </div>

      <PageHeader
        title={activity.description}
        description={`Activity ID: ${activity.id}`}
      />

      {/* Status Card */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {getStatusIcon(activity.status)}
              <div>
                <CardTitle className="text-lg">Status</CardTitle>
                <CardDescription>
                  <span className={`font-medium capitalize ${getStatusColor(activity.status)}`}>
                    {activity.status}
                  </span>
                </CardDescription>
              </div>
            </div>
            {activity.cost && (
              <div className="text-right">
                <p className="text-sm text-muted-foreground">Cost</p>
                <p className="text-2xl font-bold">{formatCost(activity.cost)}</p>
              </div>
            )}
          </div>
        </CardHeader>
      </Card>

      {/* Metadata Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Activity ID</CardTitle>
          </CardHeader>
          <CardContent>
            <code className="text-xs break-all">{activity.id}</code>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Session ID</CardTitle>
          </CardHeader>
          <CardContent>
            <code className="text-xs break-all">{activity.sessionId}</code>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Actor</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              <p className="text-sm">
                <span className="text-muted-foreground">Type:</span>{" "}
                <span className="font-medium">{activity.actor.type}</span>
              </p>
              <p className="text-sm">
                <span className="text-muted-foreground">ID:</span>{" "}
                <code className="text-xs">{activity.actor.id}</code>
              </p>
              {activity.actor.role && (
                <p className="text-sm">
                  <span className="text-muted-foreground">Role:</span>{" "}
                  <span>{activity.actor.role}</span>
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Action Type</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="inline-flex items-center rounded-md bg-secondary px-2 py-1 text-sm font-medium">
              {activity.actionType}
            </span>
          </CardContent>
        </Card>

        {activity.toolName && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Tool</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm font-medium">{activity.toolName}</p>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Started</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{formatTimestamp(activity.timestamp)}</p>
          </CardContent>
        </Card>

        {activity.completedAt && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Completed</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm">{formatTimestamp(activity.completedAt)}</p>
            </CardContent>
          </Card>
        )}

        {activity.durationMs !== undefined && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Duration</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm">{activity.durationMs}ms</p>
            </CardContent>
          </Card>
        )}

        {activity.tokens && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Tokens</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                <p className="text-sm">
                  <span className="text-muted-foreground">Total:</span>{" "}
                  <span className="font-medium">{activity.tokens.totalTokens.toLocaleString()}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  Input: {activity.tokens.inputTokens.toLocaleString()} /{" "}
                  Output: {activity.tokens.outputTokens.toLocaleString()}
                </p>
                {activity.tokens.model && (
                  <p className="text-xs text-muted-foreground">Model: {activity.tokens.model}</p>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {activity.cost?.breakdown && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Cost Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">
                  Input: ${activity.cost.breakdown.inputCost.toFixed(6)}
                </p>
                <p className="text-xs text-muted-foreground">
                  Output: ${activity.cost.breakdown.outputCost.toFixed(6)}
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Details Section */}
      {activity.details && Object.keys(activity.details).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="rounded-md bg-muted p-4 text-xs overflow-x-auto">
              {formatJson(activity.details)}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* Result Section */}
      {activity.result && (
        <Card>
          <CardHeader>
            <CardTitle>Result</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Success:</span>
              <span
                className={`text-sm font-medium ${
                  activity.result.success ? "text-green-600" : "text-red-600"
                }`}
              >
                {activity.result.success ? "Yes" : "No"}
              </span>
            </div>
            {activity.result.exitCode !== undefined && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Exit Code:</span>
                <code className="text-sm">{activity.result.exitCode}</code>
              </div>
            )}
            <Separator />
            {activity.result.output && (
              <div>
                <p className="text-sm font-medium mb-2">Output:</p>
                <pre className="rounded-md bg-muted p-4 text-xs overflow-x-auto max-h-60">
                  {activity.result.output}
                </pre>
              </div>
            )}
            {activity.result.error && (
              <div>
                <p className="text-sm font-medium mb-2 text-red-600">Error:</p>
                <pre className="rounded-md bg-red-50 dark:bg-red-950 p-4 text-xs overflow-x-auto text-red-600">
                  {activity.result.error}
                </pre>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* References Section */}
      {activity.references && Object.keys(activity.references).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>References</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="rounded-md bg-muted p-4 text-xs overflow-x-auto">
              {formatJson(activity.references)}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* Tags Section */}
      {activity.tags && activity.tags.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Tags</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {activity.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary"
                >
                  {tag}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
