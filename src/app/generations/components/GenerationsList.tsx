import { AlertCircle, Image as ImageIcon } from "lucide-react";
import { PageHeader } from "@/components/_shared/PageHeader";
import { EmptyState } from "@/components/_shared/EmptyState";
import { Card, CardContent } from "@/components/ui/card";
import { useSourceFilter } from "@/app/source-context";
import { scopePhrase } from "@/config/sourceScope";
import { useGenerations } from "@/lib/queries";
import {
  getEmptyWorkloadPageState,
  getWorkloadAvailability,
  workloadSetupActions,
} from "@/lib/workload-availability";
import { GenerationCard } from "./GenerationCard";

function generationsEmptyCopy(
  state: ReturnType<typeof getEmptyWorkloadPageState>,
) {
  switch (state) {
    case "not_configured":
      return {
        title: "Generations are not configured",
        description:
          "No generation source (ComfyUI) is registered in this deployment.",
        detail: undefined as string | undefined,
      };
    case "disabled":
      return {
        title: "ComfyUI is offline",
        description:
          "Image and video generation jobs appear here when ComfyUI is running and the collector is enabled.",
        detail: "Set MC_COMFYUI_POLLING_ENABLED=true on the API server.",
      };
    case "error":
      return {
        title: "ComfyUI collector error",
        description:
          "The generation source reported an error. Check source health and collector logs, then retry.",
        detail: undefined,
      };
    case "no_data":
    default:
      return {
        title: "No generation jobs observed yet",
        description:
          "Submit a ComfyUI workflow — jobs appear here once the collector observes them.",
        detail: undefined,
      };
  }
}

export function GenerationsList() {
  const {
    selectedSourceId,
    sources,
    isLoading: sourcesLoading,
    error: sourcesError,
  } = useSourceFilter();
  const {
    data: jobs,
    isLoading,
    error,
  } = useGenerations({
    sourceId: selectedSourceId,
  });
  const pageDescription = `Image/video generation jobs (ComfyUI) ${scopePhrase(selectedSourceId, sources)}`;

  const availability = getWorkloadAvailability(
    "generations",
    (sourcesLoading && sources.length === 0) || sourcesError
      ? undefined
      : sources,
  );
  const emptyState = getEmptyWorkloadPageState(availability);
  const emptyCopy = generationsEmptyCopy(emptyState);

  return (
    <div className="space-y-6">
      <PageHeader title="Generations" description={pageDescription} />

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              className="h-[140px] rounded-lg bg-muted animate-pulse"
            />
          ))}
        </div>
      ) : error ? (
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-3 py-6">
            <AlertCircle className="h-5 w-5 text-destructive shrink-0" />
            <p className="text-sm text-muted-foreground">
              {error instanceof Error
                ? error.message
                : "Failed to load generations"}
            </p>
          </CardContent>
        </Card>
      ) : !jobs || jobs.length === 0 ? (
        <EmptyState
          state={emptyState}
          icon={ImageIcon}
          title={emptyCopy.title}
          description={emptyCopy.description}
          detail={emptyCopy.detail ?? availability.reason}
          actions={
            emptyState === "no_data"
              ? workloadSetupActions("generations").slice(0, 1)
              : workloadSetupActions("generations")
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {jobs.map((job) => (
            <GenerationCard key={job.id} job={job} />
          ))}
        </div>
      )}
    </div>
  );
}
