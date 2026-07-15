import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/_shared/PageHeader";
import { Loading } from "@/components/_shared/Loading";
import { Clock, AlertCircle } from "lucide-react";
import { useJobs } from "@/lib/queries";
import { ContentionIncidents } from "./ContentionIncidents";

function formatTimestamp(ms?: number): string {
  if (!ms) return "Never";
  return new Date(ms).toLocaleString();
}

export function JobsList() {
  const navigate = useNavigate();
  const { data: jobs, isLoading, error } = useJobs();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Jobs"
          description="Background work — Hermes jobs and collector self-observation"
        />
        <Loading />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Jobs"
          description="Background work — Hermes jobs and collector self-observation"
        />
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
      <PageHeader
        title="Jobs"
        description="Background work — Hermes jobs and collector self-observation"
      />

      {count === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Clock className="mx-auto h-12 w-12 text-muted-foreground/30" />
            <p className="mt-4 text-muted-foreground">
              No background jobs observed yet.
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Jobs appear here once a collector or Hermes background task runs.
            </p>
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
