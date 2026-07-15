import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Image as ImageIcon } from "lucide-react";
import type { GenerationJob } from "@/lib/queries";

function statusVariant(
  status: string,
): "success" | "destructive" | "secondary" | "outline" {
  if (status === "success") return "success";
  if (status === "error" || status === "interrupted") return "destructive";
  if (status === "running") return "secondary";
  return "outline"; // queued
}

function formatRelativeTime(timestamp: string): string {
  const diffMs = Date.now() - new Date(timestamp).getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  if (diffSecs < 60) return `${diffSecs}s ago`;
  const diffMins = Math.floor(diffSecs / 60);
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

export function GenerationCard({ job }: { job: GenerationJob }) {
  const navigate = useNavigate();

  const durationMs =
    job.observedStartedAt && job.observedCompletedAt
      ? new Date(job.observedCompletedAt).getTime() -
        new Date(job.observedStartedAt).getTime()
      : null;

  return (
    <Card
      className="hover:shadow-md transition-shadow duration-200 cursor-pointer"
      onClick={() => navigate(`/generations/${job.id}`)}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm font-mono truncate">
            {job.externalId}
          </CardTitle>
          <Badge
            variant={statusVariant(job.status)}
            className="text-xs capitalize shrink-0"
          >
            {job.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ImageIcon className="h-4 w-4" />
          <span>
            {job.outputCount ?? 0} output{job.outputCount === 1 ? "" : "s"}
          </span>
          {job.nodeCount != null && (
            <span className="text-xs">· {job.nodeCount} nodes</span>
          )}
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{formatRelativeTime(job.firstSeenAt)}</span>
          {durationMs != null && <span>{(durationMs / 1000).toFixed(1)}s</span>}
        </div>
      </CardContent>
    </Card>
  );
}
