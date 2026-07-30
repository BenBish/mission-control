import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/_shared/PageHeader";
import { Loading } from "@/components/_shared/Loading";
import { AlertTriangle } from "lucide-react";
import { useFilterableSourceId, useSourceFilter } from "@/app/source-context";
import { scopePhrase } from "@/config/sourceScope";
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
  const { sources } = useSourceFilter();
  const selectedSourceId = useFilterableSourceId();
  const pageDescription = `Recent failures ${scopePhrase(selectedSourceId, sources)}`;
  const {
    data: failuresData,
    isLoading,
    error,
  } = useFailures({ limit: 50, sourceId: selectedSourceId });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Failure Analysis" description={pageDescription} />
        <Loading />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Failure Analysis" description={pageDescription} />
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

  const failures = failuresData?.failures ?? [];
  const summary = failuresData?.summary;
  const total = summary?.total ?? 0;
  const last24Hours = summary?.last24Hours ?? 0;
  const openRuntime = summary?.openRuntimeEvents ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader title="Failure Analysis" description={pageDescription} />

      <div className="flex flex-wrap gap-4">
        <Card className="overflow-hidden border-l-4 border-l-red-500 sm:w-64">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Failures
            </CardTitle>
            <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/30">
              <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tracking-tight tabular-nums">
              {total.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              All time · activity failure · inference non-success · runtime
              non-info
            </p>
          </CardContent>
        </Card>

        <Card className="overflow-hidden border-l-4 border-l-orange-500 sm:w-64">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Last 24 Hours
            </CardTitle>
            <div className="p-2 rounded-lg bg-orange-100 dark:bg-orange-900/30">
              <AlertTriangle className="h-4 w-4 text-orange-600 dark:text-orange-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tracking-tight tabular-nums">
              {last24Hours.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Last 24 hours · activity failure · inference non-success · runtime
              non-info
            </p>
          </CardContent>
        </Card>

        {openRuntime > 0 && (
          <Card className="overflow-hidden border-l-4 border-l-amber-500 sm:w-64">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Open Runtime
              </CardTitle>
              <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold tracking-tight tabular-nums">
                {openRuntime.toLocaleString()}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Unresolved · severity ≠ info, no end time
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {total === 0 ? (
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
                  {failures.map((f) => (
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
            {total > failures.length && (
              <p className="px-4 py-3 text-xs text-muted-foreground border-t">
                Showing {failures.length.toLocaleString()} of{" "}
                {total.toLocaleString()} failures
                {summary?.byKind
                  ? ` (${summary.byKind.activity} activity · ${summary.byKind.inference_request} inference · ${summary.byKind.runtime_event} runtime)`
                  : ""}
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
