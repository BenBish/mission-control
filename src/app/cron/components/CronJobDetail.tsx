import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Play, Trash2, AlertCircle } from "lucide-react";
import { useCronJobDetail, useCronMutations } from "../hooks/useCronJobs";

interface CronJobDetailProps {
  jobId: string;
}

export function CronJobDetail({ jobId }: CronJobDetailProps) {
  const navigate = useNavigate();
  const { job, isLoading, error } = useCronJobDetail(jobId);
  const { runs, isLoadingRuns, errorRuns, runNow, deleteJob } =
    useCronMutations(jobId);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="p-8 text-center">
        <div className="inline-block animate-spin">⏳</div>
        <p className="mt-4 text-muted-foreground">Loading job details...</p>
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="p-8">
        <Button
          variant="ghost"
          onClick={() => navigate("/cron")}
          className="mb-4"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Jobs
        </Button>
        <div className="rounded-lg bg-red-50 p-4 dark:bg-red-950/30">
          <div className="flex gap-3">
            <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
            <div>
              <h3 className="font-semibold text-red-900 dark:text-red-200">
                Job not found
              </h3>
              <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <Button
        variant="ghost"
        onClick={() => navigate("/cron")}
        className="mb-2"
      >
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to Jobs
      </Button>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold">{job.name}</h1>
          <p className="mt-1 text-muted-foreground">ID: {job.id}</p>
        </div>
        <Badge
          className={
            job.enabled
              ? "bg-green-100 text-green-900 dark:bg-green-950/30 dark:text-green-400"
              : "bg-gray-100 text-gray-900 dark:bg-gray-950/30 dark:text-gray-400"
          }
        >
          {job.enabled ? "Enabled" : "Disabled"}
        </Badge>
      </div>

      {/* Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-semibold text-muted-foreground">
              Schedule
            </label>
            <p className="mt-1">{job.scheduleHuman}</p>
          </div>
          <div>
            <label className="text-sm font-semibold text-muted-foreground">
              Next Run
            </label>
            <p className="mt-1">{job.nextRun || "—"}</p>
          </div>
          <div>
            <label className="text-sm font-semibold text-muted-foreground">
              Last Run
            </label>
            <p className="mt-1">{job.lastRun || "Never run"}</p>
          </div>
          <div>
            <label className="text-sm font-semibold text-muted-foreground">
              Payload Type
            </label>
            <p className="mt-1 font-mono text-sm">{job.payload.kind}</p>
          </div>
          <div>
            <label className="text-sm font-semibold text-muted-foreground">
              Session Target
            </label>
            <p className="mt-1">{job.sessionTarget}</p>
          </div>
          {job.model && (
            <div>
              <label className="text-sm font-semibold text-muted-foreground">
                Model
              </label>
              <p className="mt-1 font-mono text-sm">{job.model}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Run History */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Recent Runs</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoadingRuns ? (
            <p className="text-sm text-muted-foreground">Loading history...</p>
          ) : errorRuns ? (
            <p className="text-sm text-red-600">Error loading runs</p>
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
                    <p className="text-xs text-muted-foreground">
                      {run.duration}ms
                    </p>
                  </div>
                  <Badge
                    variant={
                      run.status === "success"
                        ? "default"
                        : run.status === "pending"
                          ? "secondary"
                          : "destructive"
                    }
                    className={
                      run.status === "success"
                        ? "bg-green-100 text-green-900 dark:bg-green-950/30 dark:text-green-400"
                        : run.status === "pending"
                          ? "bg-yellow-100 text-yellow-900 dark:bg-yellow-950/30 dark:text-yellow-400"
                          : run.status === "timeout"
                            ? "bg-orange-100 text-orange-900 dark:bg-orange-950/30 dark:text-orange-400"
                            : ""
                    }
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

      {/* Actions */}
      <div className="space-y-2">
        <div className="flex gap-3">
          <Button
            variant="default"
            className="gap-2"
            disabled={isRunning}
            onClick={async () => {
              setIsRunning(true);
              setRunError(null);
              try {
                const ok = await runNow();
                if (!ok) setRunError("Failed to trigger job");
              } catch (err) {
                setRunError(
                  err instanceof Error ? err.message : "Unknown error",
                );
              } finally {
                setIsRunning(false);
              }
            }}
          >
            <Play className="h-4 w-4" />
            {isRunning ? "Running…" : "Run Now"}
          </Button>
          <Button
            variant="destructive"
            onClick={() => setShowDeleteConfirm(true)}
            className="gap-2"
            disabled={isDeleting}
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </Button>
        </div>
        {runError && (
          <p className="text-sm text-red-600 dark:text-red-400">{runError}</p>
        )}
        {deleteError && (
          <p className="text-sm text-red-600 dark:text-red-400">
            {deleteError}
          </p>
        )}
      </div>

      {/* Delete Confirmation */}
      {showDeleteConfirm && (
        <Card className="border-red-200 bg-red-50 dark:border-red-950/50 dark:bg-red-950/20">
          <CardContent className="pt-6">
            <p className="mb-4 font-semibold">Delete this cron job?</p>
            <p className="mb-6 text-sm text-muted-foreground">
              This action cannot be undone. The job will be permanently deleted.
            </p>
            <div className="flex gap-3">
              <Button
                variant="destructive"
                disabled={isDeleting}
                onClick={async () => {
                  setIsDeleting(true);
                  setDeleteError(null);
                  try {
                    const ok = await deleteJob();
                    if (ok) {
                      navigate("/cron");
                    } else {
                      setDeleteError("Failed to delete job");
                      setShowDeleteConfirm(false);
                    }
                  } catch (err) {
                    setDeleteError(
                      err instanceof Error ? err.message : "Unknown error",
                    );
                    setShowDeleteConfirm(false);
                  } finally {
                    setIsDeleting(false);
                  }
                }}
              >
                {isDeleting ? "Deleting…" : "Delete"}
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowDeleteConfirm(false)}
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
