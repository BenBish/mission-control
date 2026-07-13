import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle } from "lucide-react";
import { useContention } from "@/lib/queries";

function formatDuration(ms: number | null): string {
  if (ms == null) return "unknown duration";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Workload classification is a best-effort heuristic (see
 * src/collectors/hermes/workload-correlation.ts) — an empty list here is
 * the expected steady state, not a sign anything is broken. Never invent
 * placeholder incidents to make this look more populated.
 */
export function ContentionIncidents() {
  const { data: incidents, isLoading, error } = useContention(20);

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" />
          Contention Incidents
        </CardTitle>
        <CardDescription>
          Background work (best-effort classified) that held a slot while a
          foreground turn waited
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : error ? (
          <p className="text-sm text-muted-foreground">
            {error instanceof Error ? error.message : "Failed to load"}
          </p>
        ) : !incidents || incidents.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No contention detected. Workload classification only tags a request
            as background when it correlates with a known background job
            signature — this list stays empty unless that heuristic finds a
            real, timing-overlapping match.
          </p>
        ) : (
          <div className="space-y-3">
            {incidents.map((incident) => (
              <div key={incident.id} className="rounded-lg border p-3 text-sm">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="warning" className="text-xs">
                    {incident.backgroundClientLabel ?? "background"}
                  </Badge>
                  <span className="text-muted-foreground">held a slot for</span>
                  <span className="font-medium">
                    {formatDuration(incident.backgroundDurationMs)}
                  </span>
                  <span className="text-muted-foreground">
                    during saturation on {incident.instanceId}
                  </span>
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {incident.saturationSummary}
                  {incident.foregroundTtftMs != null &&
                    ` — a foreground turn's time-to-first-token was ${incident.foregroundTtftMs}ms`}
                </p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
