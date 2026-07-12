import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, AlertCircle } from "lucide-react";
import { useJob, useJobRuns } from "@/lib/queries";
import { Loading } from "@/components/_shared/Loading";

interface JobDetailProps {
  jobId: string;
}

function statusVariant(
  status: string,
): "success" | "destructive" | "secondary" {
  if (status === "success") return "success";
  if (status === "running") return "secondary";
  return "destructive";
}

export function JobDetail({ jobId }: JobDetailProps) {
  const navigate = useNavigate();
  const { data: job, isLoading, error } = useJob(jobId);
  const { data: runs, isLoading: runsLoading } = useJobRuns(jobId, 20);

  if (isLoading) {
    return (
      <div className="p-6">
        <Loading />
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="space-y-4 p-6">
        <Button variant="ghost" onClick={() => navigate("/jobs")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Jobs
        </Button>
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-3 py-6">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <p className="text-sm text-muted-foreground">
              {error instanceof Error ? error.message : "Job not found"}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => navigate("/jobs")}>
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to Jobs
      </Button>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{job.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground font-mono">
            {job.id}
          </p>
        </div>
        <Badge variant="secondary">{job.sourceId}</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Status</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-sm text-muted-foreground">Kind</p>
            <p className="mt-1 capitalize">{job.kind}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Last Status</p>
            <p className="mt-1">
              {job.state.lastRunStatus ? (
                <Badge
                  variant={statusVariant(job.state.lastRunStatus)}
                  className="capitalize"
                >
                  {job.state.lastRunStatus}
                </Badge>
              ) : (
                "Never run"
              )}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Consecutive Errors</p>
            <p className="mt-1">{job.state.consecutiveErrors ?? 0}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Recent Runs</CardTitle>
        </CardHeader>
        <CardContent>
          {runsLoading ? (
            <p className="text-sm text-muted-foreground">Loading history...</p>
          ) : runs && runs.length > 0 ? (
            <div className="space-y-3">
              {runs.map((run) => (
                <div
                  key={run.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div>
                    <p className="text-sm font-medium">
                      {new Date(run.timestamp).toLocaleString()}
                    </p>
                    {run.duration != null && (
                      <p className="text-xs text-muted-foreground">
                        {run.duration}ms
                      </p>
                    )}
                    {run.error && (
                      <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                        {run.error}
                      </p>
                    )}
                  </div>
                  <Badge
                    variant={statusVariant(run.status)}
                    className="capitalize"
                  >
                    {run.status}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No runs yet</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
