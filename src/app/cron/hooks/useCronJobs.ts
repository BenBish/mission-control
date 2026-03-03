import { useEffect, useState, useCallback } from "react";
import type { CronJob, RunHistory } from "@/types/cron";

export function useCronJobs(profileId?: string) {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchJobs = async () => {
      try {
        setIsLoading(true);
        const url = profileId
          ? `/api/cron/jobs?profile=${encodeURIComponent(profileId)}`
          : "/api/cron/jobs";
        const response = await fetch(url);
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
  }, [profileId]);

  return { jobs, isLoading, error };
}

export function useCronJobDetail(jobId: string, profileId?: string) {
  const [job, setJob] = useState<CronJob | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchJob = async () => {
      try {
        setIsLoading(true);
        const profileParam = profileId
          ? `?profile=${encodeURIComponent(profileId)}`
          : "";
        const response = await fetch(`/api/cron/jobs/${jobId}${profileParam}`);
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
  }, [jobId, profileId]);

  return { job, isLoading, error };
}

export function useCronMutations(jobId: string, profileId?: string) {
  const [runs, setRuns] = useState<RunHistory[]>([]);
  const [isLoadingRuns, setIsLoadingRuns] = useState(true);
  const [errorRuns, setErrorRuns] = useState<string | null>(null);

  useEffect(() => {
    const fetchRuns = async () => {
      try {
        setIsLoadingRuns(true);
        const profileParam = profileId
          ? `&profile=${encodeURIComponent(profileId)}`
          : "";
        const response = await fetch(
          `/api/cron/jobs/${jobId}/runs?limit=20${profileParam}`,
        );
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
  }, [jobId, profileId]);

  const profileParam = profileId
    ? `?profile=${encodeURIComponent(profileId)}`
    : "";

  const enableJob = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/cron/jobs/${jobId}/enable${profileParam}`,
        {
          method: "POST",
        },
      );
      const data = await response.json();
      return data.success;
    } catch {
      return false;
    }
  }, [jobId, profileParam]);

  const disableJob = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/cron/jobs/${jobId}/disable${profileParam}`,
        {
          method: "POST",
        },
      );
      const data = await response.json();
      return data.success;
    } catch {
      return false;
    }
  }, [jobId, profileParam]);

  const runNow = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/cron/jobs/${jobId}/run${profileParam}`,
        {
          method: "POST",
        },
      );
      const data = await response.json();
      return data.success;
    } catch {
      return false;
    }
  }, [jobId, profileParam]);

  const deleteJob = useCallback(async () => {
    try {
      const response = await fetch(`/api/cron/jobs/${jobId}${profileParam}`, {
        method: "DELETE",
      });
      const data = await response.json();
      return data.success;
    } catch {
      return false;
    }
  }, [jobId, profileParam]);

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
