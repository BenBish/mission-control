import { lazy, Suspense } from "react";
import { useParams } from "react-router-dom";
import { Loading } from "@/components/_shared/Loading";

const CronJobsList = lazy(() =>
  import("./components/CronJobsList").then((m) => ({
    default: m.CronJobsList,
  }))
);
const CronJobDetail = lazy(() =>
  import("./components/CronJobDetail").then((m) => ({
    default: m.CronJobDetail,
  }))
);

export function CronPage() {
  const { jobId } = useParams<{ jobId?: string }>();

  return (
    <Suspense fallback={<Loading />}>
      {jobId ? (
        <CronJobDetail jobId={jobId} />
      ) : (
        <CronJobsList />
      )}
    </Suspense>
  );
}
