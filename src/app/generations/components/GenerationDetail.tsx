import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, AlertCircle, Image as ImageIcon } from "lucide-react";
import { useGeneration } from "@/lib/queries";
import { Loading } from "@/components/_shared/Loading";

interface GenerationDetailProps {
  generationId: string;
}

function statusVariant(
  status: string,
): "success" | "destructive" | "secondary" | "outline" {
  if (status === "success") return "success";
  if (status === "error" || status === "interrupted") return "destructive";
  if (status === "running") return "secondary";
  return "outline";
}

export function GenerationDetail({ generationId }: GenerationDetailProps) {
  const navigate = useNavigate();
  const { data: job, isLoading, error } = useGeneration(generationId);

  if (isLoading) {
    return (
      <div className="p-6">
        <Loading />
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => navigate("/generations")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Generations
        </Button>
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-3 py-6">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <p className="text-sm text-muted-foreground">
              {error instanceof Error
                ? error.message
                : "Generation job not found"}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const durationMs =
    job.observedStartedAt && job.observedCompletedAt
      ? new Date(job.observedCompletedAt).getTime() -
        new Date(job.observedStartedAt).getTime()
      : null;

  return (
    <div className="space-y-6">
      <Button variant="ghost" onClick={() => navigate("/generations")}>
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to Generations
      </Button>

      <Card>
        <CardHeader>
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 dark:bg-primary/20">
              <ImageIcon className="h-6 w-6 text-primary" />
            </div>
            <div>
              <CardTitle className="text-xl font-mono">
                {job.externalId}
              </CardTitle>
              <div className="mt-2">
                <Badge
                  variant={statusVariant(job.status)}
                  className="capitalize"
                >
                  {job.status}
                </Badge>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider">
              First seen
            </p>
            <p className="text-sm">
              {new Date(job.firstSeenAt).toLocaleString()}
            </p>
          </div>
          {job.observedStartedAt && (
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">
                Started
              </p>
              <p className="text-sm">
                {new Date(job.observedStartedAt).toLocaleString()}
              </p>
            </div>
          )}
          {job.observedCompletedAt && (
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">
                Completed
              </p>
              <p className="text-sm">
                {new Date(job.observedCompletedAt).toLocaleString()}
              </p>
            </div>
          )}
          {durationMs != null && (
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">
                Duration
              </p>
              <p className="text-sm">{(durationMs / 1000).toFixed(1)}s</p>
            </div>
          )}
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider">
              Nodes
            </p>
            <p className="text-sm">{job.nodeCount ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider">
              Outputs
            </p>
            <p className="text-sm">{job.outputCount ?? 0}</p>
          </div>
          {job.workflowHash && (
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">
                Workflow hash
              </p>
              <p className="text-sm font-mono">{job.workflowHash}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Synthesized for grouping — not provided by ComfyUI itself
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {job.details != null && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Raw details</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-xs bg-muted rounded-lg p-3 overflow-x-auto">
              {JSON.stringify(job.details, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
