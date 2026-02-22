import { useEffect, useState, useCallback } from "react";
import type { CronJob, RunHistory } from "@/types/cron";

export function useCronJobs() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchJobs = async () => {
      try {
        setIsLoading(true);
        const response = await fetch("/api/cron/jobs");
        const data = await response.json();

        if (data.success) {
          setJobs(data.jobs);
          setError(null);
        } else {
          setError(data.error || "Failed to fetch jobs");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setIsLoading(false);
      }
    };

    fetchJobs();
    const interval = setInterval(fetchJobs, 30000); // Refresh every 30s

    return () => clearInterval(interval);
  }, []);

  return { jobs, isLoading, error };
}

export function useCronJobDetail(jobId: string) {
  const [job, setJob] = useState<CronJob | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchJob = async () => {
      try {
        setIsLoading(true);
        const response = await fetch(`/api/cron/jobs/${jobId}`);
        const data = await response.json();

        if (data.success) {
          setJob(data.job);
          setError(null);
        } else {
          setError(data.error || "Failed to fetch job");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setIsLoading(false);
      }
    };

    fetchJob();
    const interval = setInterval(fetchJob, 30000);

    return () => clearInterval(interval);
  }, [jobId]);

  return { job, isLoading, error };
}

export function useCronMutations(jobId: string) {
  const [runs, setRuns] = useState<RunHistory[]>([]);
  const [isLoadingRuns, setIsLoadingRuns] = useState(true);
  const [errorRuns, setErrorRuns] = useState<string | null>(null);

  useEffect(() => {
    const fetchRuns = async () => {
      try {
        setIsLoadingRuns(true);
        const response = await fetch(`/api/cron/jobs/${jobId}/runs?limit=20`);
        const data = await response.json();

        if (data.success) {
          setRuns(data.runs);
          setErrorRuns(null);
        } else {
          setErrorRuns(data.error || "Failed to fetch runs");
        }
      } catch (err) {
        setErrorRuns(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setIsLoadingRuns(false);
      }
    };

    fetchRuns();
  }, [jobId]);

  const enableJob = useCallback(async () => {
    try {
      const response = await fetch(`/api/cron/jobs/${jobId}/enable`, {
        method: "POST",
      });
      const data = await response.json();
      return data.success;
    } catch {
      return false;
    }
  }, [jobId]);

  const disableJob = useCallback(async () => {
    try {
      const response = await fetch(`/api/cron/jobs/${jobId}/disable`, {
        method: "POST",
      });
      const data = await response.json();
      return data.success;
    } catch {
      return false;
    }
  }, [jobId]);

  const runNow = useCallback(async () => {
    try {
      const response = await fetch(`/api/cron/jobs/${jobId}/run`, {
        method: "POST",
      });
      const data = await response.json();
      return data.success;
    } catch {
      return false;
    }
  }, [jobId]);

  const deleteJob = useCallback(async () => {
    try {
      const response = await fetch(`/api/cron/jobs/${jobId}`, {
        method: "DELETE",
      });
      const data = await response.json();
      return data.success;
    } catch {
      return false;
    }
  }, [jobId]);

  return {
    runs,
    isLoadingRuns,
    errorRuns,
    enableJob,
    disableJob,
    runNow,
    deleteJob,
  };
}
