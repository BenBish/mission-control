import { useParams } from "react-router-dom";
import { JobsList } from "./components/JobsList";
import { JobDetail } from "./components/JobDetail";

export default function JobsPage() {
  const { jobId } = useParams<{ jobId?: string }>();
  return jobId ? <JobDetail jobId={jobId} /> : <JobsList />;
}
