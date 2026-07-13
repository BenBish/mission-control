import { Image as ImageIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/_shared/PageHeader";
import { useGenerations } from "@/lib/queries";
import { GenerationCard } from "./GenerationCard";

export function GenerationsList() {
  const { data: jobs, isLoading, error } = useGenerations();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Generations"
        description="Image/video generation jobs (ComfyUI)"
      />

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
            <p className="text-sm text-muted-foreground">
              {error instanceof Error
                ? error.message
                : "Failed to load generations"}
            </p>
          </CardContent>
        </Card>
      ) : !jobs || jobs.length === 0 ? (
        // ComfyUI (and Lemonade, which doesn't emit generation jobs) both
        // default to disabled — an empty grid here is the correct steady
        // state for a fresh deploy, not a bug. No fake cards.
        <Card>
          <CardContent className="py-16 text-center">
            <ImageIcon className="mx-auto h-12 w-12 text-muted-foreground/30" />
            <p className="mt-4 text-muted-foreground">
              No generation jobs observed yet.
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              ComfyUI is currently disabled — jobs appear here once it's running
              and a workflow is submitted.
            </p>
          </CardContent>
        </Card>
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
