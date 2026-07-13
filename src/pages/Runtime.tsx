import { Link } from "react-router-dom";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/_shared/PageHeader";
import { Loading } from "@/components/_shared/Loading";
import {
  Server,
  Cpu,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
} from "lucide-react";
import {
  useRuntime,
  type InferenceRequestSummary,
  type RuntimeEvent,
  type RuntimeSnapshot,
  type Source,
} from "@/lib/queries";

function formatRelativeTime(timestamp: string | null): string {
  if (!timestamp) return "never";
  const diffMs = new Date().getTime() - new Date(timestamp).getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  if (diffSecs < 60) return `${diffSecs}s ago`;
  const diffMins = Math.floor(diffSecs / 60);
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

function statusVariant(
  status: string,
): "success" | "destructive" | "secondary" | "outline" {
  if (status === "ok") return "success";
  if (status === "error") return "destructive";
  if (status === "off") return "outline";
  return "secondary";
}

function InstanceHealthCard({
  source,
  instanceId,
  status,
  lastSeenAt,
  lastError,
}: {
  source: string;
  instanceId: string;
  status: string;
  lastSeenAt: string | null;
  lastError: string | null;
}) {
  return (
    <Card
      className={`overflow-hidden border-l-4 ${
        status === "ok"
          ? "border-l-green-500"
          : status === "error"
            ? "border-l-red-500"
            : "border-l-muted-foreground/30"
      }`}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{source}</CardTitle>
        <Badge variant={statusVariant(status)} className="capitalize">
          {status}
        </Badge>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground font-mono">{instanceId}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {status === "off"
            ? "Not connected — no collector polling this source yet"
            : `Last seen ${formatRelativeTime(lastSeenAt)}`}
        </p>
        {lastError && (
          <p className="mt-1 text-xs text-red-600 dark:text-red-400">
            {lastError}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function SlotOccupancyRow({ snapshot }: { snapshot: RuntimeSnapshot }) {
  const total = snapshot.slotsTotal ?? 0;
  const busy = snapshot.slotsBusy ?? 0;
  const label = snapshot.payload?.label ?? snapshot.instanceId;
  const port = snapshot.payload?.port;

  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="min-w-0">
        <p className="text-sm font-medium">
          {label}
          {port != null && (
            <span className="ml-1.5 text-xs text-muted-foreground font-mono">
              :{port}
            </span>
          )}
        </p>
        <p className="text-xs text-muted-foreground">
          {formatRelativeTime(snapshot.timestamp)}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex gap-1">
          {Array.from({ length: total }).map((_, i) => (
            <div
              key={i}
              className={`h-4 w-4 rounded-sm border ${
                i < busy
                  ? "bg-amber-500 border-amber-600"
                  : "bg-muted border-border"
              }`}
              title={i < busy ? "busy" : "idle"}
            />
          ))}
        </div>
        <span className="text-sm tabular-nums text-muted-foreground w-12 text-right">
          {busy}/{total}
        </span>
      </div>
    </div>
  );
}

function requestStatusVariant(
  status: string,
): "success" | "destructive" | "secondary" {
  if (status === "success") return "success";
  if (status === "cancelled") return "secondary";
  return "destructive";
}

function eventSeverityVariant(
  severity: string,
): "success" | "destructive" | "warning" | "secondary" {
  if (severity === "error") return "destructive";
  if (severity === "warning") return "warning";
  return "secondary";
}

function RuntimeEventRow({ event }: { event: RuntimeEvent }) {
  return (
    <div className="flex items-start gap-3 py-2">
      <Badge
        variant={eventSeverityVariant(event.severity)}
        className="mt-0.5 shrink-0 capitalize"
      >
        {event.kind.replace(/_/g, " ")}
      </Badge>
      <div className="min-w-0 flex-1">
        <p className="text-sm">{event.summary}</p>
        <p className="text-xs text-muted-foreground">
          {formatRelativeTime(event.timestamp)}
          {event.endedAt && ` — resolved ${formatRelativeTime(event.endedAt)}`}
        </p>
      </div>
    </div>
  );
}

function InferenceRequestRow({
  request,
}: {
  request: InferenceRequestSummary;
}) {
  return (
    <tr className="border-b last:border-0 hover:bg-muted/40">
      <td className="py-3 px-4 text-sm text-muted-foreground whitespace-nowrap">
        {formatRelativeTime(request.timestamp)}
      </td>
      <td className="py-3 px-4 text-sm">
        <Badge variant="secondary" className="text-xs">
          {request.clientLabel ?? "unknown"}
        </Badge>
      </td>
      <td className="py-3 px-4 text-sm font-mono text-xs truncate max-w-[10rem]">
        {request.model ?? "—"}
      </td>
      <td className="py-3 px-4 text-sm">
        <Badge
          variant={request.workload === "unknown" ? "outline" : "secondary"}
          className="text-xs capitalize"
          title={
            request.workload !== "unknown"
              ? "Best-effort correlation, not a precise attribution"
              : undefined
          }
        >
          {request.workload}
        </Badge>
      </td>
      <td className="py-3 px-4 text-sm text-right tabular-nums">
        {request.promptTokens ?? "—"}
      </td>
      <td className="py-3 px-4 text-sm text-right tabular-nums">
        {request.completionTokens ?? "—"}
      </td>
      <td className="py-3 px-4 text-sm text-right tabular-nums">
        {request.durationMs != null ? `${request.durationMs}ms` : "—"}
      </td>
      <td className="py-3 px-4 text-sm text-right tabular-nums">
        {request.tokensPerSec != null ? request.tokensPerSec.toFixed(1) : "—"}
      </td>
      <td className="py-3 px-4 text-sm">
        <Badge
          variant={requestStatusVariant(request.status)}
          className="text-xs capitalize"
        >
          {request.status.replace(/_/g, " ")}
        </Badge>
      </td>
    </tr>
  );
}

export default function Runtime() {
  const { data, isLoading, error } = useRuntime(50);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Runtime"
          description="Inference backend health, slot occupancy, and recent requests"
        />
        <Loading />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Runtime"
          description="Inference backend health, slot occupancy, and recent requests"
        />
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-3 py-6">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <p className="text-sm text-muted-foreground">
              {error instanceof Error ? error.message : "Unknown error"}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const sources: Source[] = data?.sources ?? [];
  const snapshots = data?.snapshots ?? [];
  const requests = data?.inferenceRequests ?? [];
  const events = data?.runtimeEvents ?? [];

  const slotSnapshots = snapshots.filter((s) => s.kind === "slots");
  const modelsSnapshot = snapshots.find((s) => s.kind === "models");
  const modelsLoaded = modelsSnapshot?.modelsLoaded ?? [];

  const anyInstances = sources.some((s) => s.instances.length > 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Runtime"
        description="Inference backend health, slot occupancy, and recent requests"
      />

      {!anyInstances ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Server className="mx-auto h-12 w-12 text-muted-foreground/30" />
            <p className="mt-4 text-muted-foreground">
              No inference sources registered yet.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sources.flatMap((source) =>
              source.instances.map((instance) => (
                <InstanceHealthCard
                  key={instance.id}
                  source={source.name}
                  instanceId={instance.id}
                  status={instance.status}
                  lastSeenAt={instance.lastSeenAt}
                  lastError={instance.lastError}
                />
              )),
            )}
          </div>

          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Cpu className="h-4 w-4" />
                Slot Occupancy
              </CardTitle>
              <CardDescription>
                Sampled every 5s — a request that starts and finishes between
                samples can be missed
              </CardDescription>
            </CardHeader>
            <CardContent className="divide-y">
              {slotSnapshots.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No slot data yet — polling may be disabled or just starting.
                </p>
              ) : (
                slotSnapshots.map((s) => (
                  <SlotOccupancyRow
                    key={`${s.instanceId}:${s.payload?.port ?? s.kind}`}
                    snapshot={s}
                  />
                ))
              )}
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Models Loaded</CardTitle>
            </CardHeader>
            <CardContent>
              {modelsLoaded.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No model inventory yet.
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {modelsLoaded.map((m) => (
                    <div
                      key={m.model}
                      className="rounded-lg border p-3 text-sm"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium truncate">{m.name}</span>
                        {m.state && (
                          <Badge
                            variant={
                              m.state === "ready" ? "success" : "secondary"
                            }
                            className="text-xs shrink-0"
                          >
                            {m.state}
                          </Badge>
                        )}
                      </div>
                      {m.description && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {m.description}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="pb-4 border-b">
              <CardTitle className="text-lg">Recent Requests</CardTitle>
              <CardDescription>
                Workload is a best-effort heuristic — badged distinctly from
                verified fields, not ground truth
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-4 px-0">
              {requests.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No inference requests observed yet.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          Time
                        </th>
                        <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          Backend
                        </th>
                        <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          Model
                        </th>
                        <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          Workload
                        </th>
                        <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          Prompt
                        </th>
                        <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          Completion
                        </th>
                        <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          Duration
                        </th>
                        <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          Tok/s
                        </th>
                        <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {requests.map((r) => (
                        <InferenceRequestRow key={r.id} request={r} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                Runtime Events
              </CardTitle>
            </CardHeader>
            <CardContent className="divide-y">
              {events.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No runtime events — no saturation, outages, or overflows
                  observed yet.
                </p>
              ) : (
                events.map((e) => <RuntimeEventRow key={e.id} event={e} />)
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex items-center justify-between py-4">
              <p className="text-sm text-muted-foreground">
                Background work contending with foreground turns is tracked on
                the Jobs page.
              </p>
              <Link
                to="/jobs"
                className="flex items-center gap-1 text-sm font-medium text-primary hover:underline"
              >
                View contention incidents
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
