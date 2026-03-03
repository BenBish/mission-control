import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, AlertCircle } from "lucide-react";
import { useCronJobs } from "../hooks/useCronJobs";
import { useProfile } from "@/app/profile-context";

export function CronJobsList() {
  const navigate = useNavigate();
  const { activeProfile, isSwitching } = useProfile();
  const { jobs, isLoading, error } = useCronJobs(activeProfile?.id);

  if (isLoading || isSwitching) {
    return (
      <div className="p-8 text-center">
        <div className="inline-block animate-spin">⏳</div>
        <p className="mt-4 text-muted-foreground">Loading cron jobs...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="rounded-lg bg-red-50 p-4 dark:bg-red-950/30">
          <div className="flex gap-3">
            <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
            <div>
              <h3 className="font-semibold text-red-900 dark:text-red-200">
                Error loading cron jobs
              </h3>
              <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      <div className="p-8 text-center">
        <Clock className="mx-auto h-12 w-12 text-muted-foreground opacity-50" />
        <h3 className="mt-4 text-lg font-semibold">No cron jobs configured</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Use `openclaw cron create` to schedule new jobs
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-3xl font-bold">Cron Jobs</h1>
        <p className="mt-1 text-muted-foreground">
          {jobs.length} scheduled {jobs.length === 1 ? "job" : "jobs"}
        </p>
      </div>

      {/* Desktop Table */}
      <div className="hidden overflow-x-auto rounded-lg border md:block">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-4 py-3 text-left text-sm font-semibold">
                Name
              </th>
              <th className="px-4 py-3 text-left text-sm font-semibold">
                Schedule
              </th>
              <th className="px-4 py-3 text-left text-sm font-semibold">
                Status
              </th>
              <th className="px-4 py-3 text-left text-sm font-semibold">
                Next Run
              </th>
              <th className="px-4 py-3 text-left text-sm font-semibold">
                Last Run
              </th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr
                key={job.id}
                className="cursor-pointer border-b hover:bg-muted/50"
                onClick={() => navigate(`/cron/${job.id}`)}
              >
                <td className="px-4 py-3 font-medium">{job.name}</td>
                <td className="px-4 py-3 text-sm text-muted-foreground">
                  {job.scheduleHuman}
                </td>
                <td className="px-4 py-3">
                  <Badge
                    variant={job.enabled ? "default" : "outline"}
                    className={
                      job.enabled
                        ? "bg-green-100 text-green-900 dark:bg-green-950/30 dark:text-green-400"
                        : ""
                    }
                  >
                    {job.enabled ? "Enabled" : "Disabled"}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-sm">{job.nextRun || "—"}</td>
                <td className="px-4 py-3 text-sm text-muted-foreground">
                  {job.lastRun || "Never"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile Cards */}
      <div className="space-y-3 md:hidden">
        {jobs.map((job) => (
          <Card
            key={job.id}
            className="cursor-pointer"
            onClick={() => navigate(`/cron/${job.id}`)}
          >
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between">
                <CardTitle className="text-base">{job.name}</CardTitle>
                <Badge
                  variant={job.enabled ? "default" : "outline"}
                  className={
                    job.enabled
                      ? "bg-green-100 text-green-900 dark:bg-green-950/30 dark:text-green-400"
                      : ""
                  }
                >
                  {job.enabled ? "On" : "Off"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div>
                <span className="text-muted-foreground">Schedule:</span>
                <span className="ml-2">{job.scheduleHuman}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Next Run:</span>
                <span className="ml-2">{job.nextRun || "—"}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Last Run:</span>
                <span className="ml-2">{job.lastRun || "Never"}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
