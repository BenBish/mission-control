import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/_shared/PageHeader";
import { Loading } from "@/components/_shared/Loading";
import { AlertTriangle } from "lucide-react";
import { useFailures } from "@/lib/queries";

const KIND_LABEL: Record<string, string> = {
  activity: "Activity",
  inference_request: "Inference",
  runtime_event: "Runtime",
};

function formatRelativeTime(timestamp: string): string {
  const diffMs = new Date().getTime() - new Date(timestamp).getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export default function FailureAnalysis() {
  const navigate = useNavigate();
  const { data: failures, isLoading, error } = useFailures(50);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Failure Analysis"
          description="Recent failures across all sources"
        />
        <Loading />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Failure Analysis"
          description="Recent failures across all sources"
        />
        <Card className="border-destructive">
          <CardContent className="py-6">
            <p className="font-medium text-destructive">Error</p>
            <p className="text-sm text-muted-foreground">
              {error instanceof Error ? error.message : "Unknown error"}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const count = failures?.length ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Failure Analysis"
        description="Recent failures across all sources"
      />

      <Card className="overflow-hidden border-l-4 border-l-red-500 sm:w-64">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Recent Failures
          </CardTitle>
          <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/30">
            <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold tracking-tight tabular-nums">
            {count}
          </div>
        </CardContent>
      </Card>

      {count === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <div className="flex flex-col items-center gap-2">
              <AlertTriangle className="h-12 w-12 text-muted-foreground/30" />
              <p className="text-muted-foreground">No failures found.</p>
              <p className="text-sm text-muted-foreground">
                Failures will appear here when activities, inference requests,
                or runtime events fail.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="shadow-sm">
          <CardContent className="pt-4 px-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Time
                    </th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Source
                    </th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Kind
                    </th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Summary
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(failures ?? []).map((f) => (
                    <tr
                      key={`${f.kind}:${f.id}`}
                      className={`border-b last:border-0 hover:bg-muted/40 ${
                        f.kind === "activity" ? "cursor-pointer" : ""
                      }`}
                      onClick={() =>
                        f.kind === "activity" && navigate(`/activities/${f.id}`)
                      }
                    >
                      <td className="py-3 px-4 text-sm text-muted-foreground whitespace-nowrap">
                        {formatRelativeTime(f.timestamp)}
                      </td>
                      <td className="py-3 px-4 text-sm">
                        <Badge variant="secondary" className="text-xs">
                          {f.sourceId}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-sm text-muted-foreground">
                        {KIND_LABEL[f.kind] ?? f.kind}
                      </td>
                      <td className="py-3 px-4 text-sm max-w-md truncate">
                        {f.summary}
                        {f.detail && (
                          <span className="text-muted-foreground">
                            {" "}
                            — {f.detail}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
