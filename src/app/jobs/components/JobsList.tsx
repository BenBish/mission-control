import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/_shared/PageHeader";
import { Loading } from "@/components/_shared/Loading";
import { EmptyState } from "@/components/_shared/EmptyState";
import { Clock, AlertCircle } from "lucide-react";
import { useSourceFilter } from "@/app/source-context";
import { scopePhrase } from "@/config/sourceScope";
import { useJobs } from "@/lib/queries";
import {
  getEmptyWorkloadPageState,
  getWorkloadAvailability,
  workloadSetupActions,
} from "@/lib/workload-availability";
import { ContentionIncidents } from "./ContentionIncidents";

function formatTimestamp(ms?: number): string {
  if (!ms) return "Never";
  return new Date(ms).toLocaleString();
}

function jobsEmptyCopy(state: ReturnType<typeof getEmptyWorkloadPageState>) {
  switch (state) {
    case "not_configured":
      return {
        title: "Jobs are not configured",
        description:
          "No job-producing sources are registered in this deployment. Add collector sources to observe background work.",
        detail: undefined as string | undefined,
      };
    case "disabled":
      return {
        title: "Job collectors are offline",
        description:
          "Related sources are intentionally offline. Enable agent or Hermes collectors to start observing background jobs.",
        detail: undefined,
      };
    case "error":
      return {
        title: "Job collectors reported errors",
        description:
          "Related sources are in an error state. Check source health in Settings, then retry once collectors recover.",
        detail: undefined,
      };
    case "no_data":
    default:
      return {
        // Keep exact title string for e2e JobsPage empty-state locator.
        title: "No background jobs observed yet.",
        description:
          "Jobs appear here once a collector or Hermes background task runs.",
        detail: undefined,
      };
  }
}

export function JobsList() {
  const navigate = useNavigate();
  const {
    selectedSourceId,
    sources,
    isLoading: sourcesLoading,
    error: sourcesError,
  } = useSourceFilter();
  const pageDescription = `Background work ${scopePhrase(selectedSourceId, sources)} — Hermes jobs and collector self-observation`;
  const {
    data: jobs,
    isLoading,
    error,
  } = useJobs({
    sourceId: selectedSourceId,
  });

  const availability = getWorkloadAvailability(
    "jobs",
    (sourcesLoading && sources.length === 0) || sourcesError
      ? undefined
      : sources,
  );
  const emptyState = getEmptyWorkloadPageState(availability);
  const emptyCopy = jobsEmptyCopy(emptyState);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Jobs" description={pageDescription} />
        <Loading />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Jobs" description={pageDescription} />
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-3 py-6">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <p className="text-sm text-muted-foreground">
              {error instanceof Error ? error.message : "Unknown error"}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const count = jobs?.length ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader title="Jobs" description={pageDescription} />

      {count === 0 ? (
        <EmptyState
          state={emptyState}
          icon={Clock}
          title={emptyCopy.title}
          description={emptyCopy.description}
          detail={emptyCopy.detail ?? availability.reason}
          actions={
            emptyState === "no_data" ? undefined : workloadSetupActions("jobs")
          }
        />
      ) : (
        <Card className="shadow-sm">
          <CardContent className="pt-4 px-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Name
                    </th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Source
                    </th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Kind
                    </th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Last Run
                    </th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(jobs ?? []).map((job) => (
                    <tr
                      key={job.id}
                      className="cursor-pointer border-b last:border-0 hover:bg-muted/50"
                      onClick={() => navigate(`/jobs/${job.id}`)}
                    >
                      <td className="px-4 py-3 text-sm font-medium">
                        {job.name}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <Badge variant="secondary" className="text-xs">
                          {job.sourceId}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground capitalize">
                        {job.kind}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {formatTimestamp(job.state.lastRunAtMs)}
                      </td>
                      <td className="px-4 py-3">
                        {job.state.lastRunStatus ? (
                          <Badge
                            variant={
                              job.state.lastRunStatus === "success"
                                ? "success"
                                : job.state.lastRunStatus === "running"
                                  ? "secondary"
                                  : "destructive"
                            }
                            className="capitalize"
                          >
                            {job.state.lastRunStatus}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
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

      <ContentionIncidents />
    </div>
  );
}
