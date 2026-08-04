import { useCallback, useEffect, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/_shared/PageHeader";
import { Loading } from "@/components/_shared/Loading";
import {
  Server,
  Cpu,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Gauge,
  Activity,
  Timer,
  Ban,
} from "lucide-react";
import {
  useRuntime,
  type InferenceRequestSummary,
  type RuntimeClientVolume,
  type RuntimeEvent,
  type RuntimeMetrics,
  type RuntimeQueryParams,
  type RuntimeRange,
  type RuntimeSnapshot,
  type Source,
  type SourceInstance,
} from "@/lib/queries";
import {
  formatExactDate,
  formatLastActive,
  formatRelativeTime,
} from "@/lib/date-utils";
import {
  clientLabelDisplay,
  formatClientLabel,
  hasOpenCodeHermesClient,
} from "@/lib/client-label-display";
import { useNow } from "@/hooks/useNow";
import {
  getEffectiveHealth,
  HEALTH_BADGE_VARIANT,
  HEALTH_BORDER_CLASS,
} from "@/services/sourceHealth";

const DEFAULT_PAGE_SIZE = 20;
const RANGES: RuntimeRange[] = ["1h", "6h", "24h", "7d", "all"];
const REQUEST_STATUSES = [
  "success",
  "cancelled",
  "context_overflow",
  "error",
] as const;
const EVENT_KINDS = [
  "slots_saturated",
  "model_load",
  "model_unload",
  "service_down",
  "service_up",
  "context_overflow",
  "request_cancelled",
] as const;

function parseRange(raw: string | null): RuntimeRange {
  if (
    raw === "1h" ||
    raw === "6h" ||
    raw === "24h" ||
    raw === "7d" ||
    raw === "all"
  ) {
    return raw;
  }
  return "24h";
}

function parsePage(raw: string | null): number {
  if (!raw) return 1;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return 1;
  return n;
}

function parseOptionalFilter(raw: string | null): string | undefined {
  if (!raw || raw === "all") return undefined;
  return raw;
}

function formatPercent(rate: number | null): string {
  if (rate == null) return "—";
  return `${(rate * 100).toFixed(1)}%`;
}

function formatRate(rate: number | null): string {
  if (rate == null) return "—";
  if (rate >= 100) return rate.toFixed(0);
  if (rate >= 10) return rate.toFixed(1);
  return rate.toFixed(2);
}

function formatLatency(ms: number | null): string {
  if (ms == null) return "—";
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.round(ms)}ms`;
}

function InstanceHealthCard({
  source,
  instance,
  now,
}: {
  source: string;
  instance: SourceInstance;
  now: number;
}) {
  const health = getEffectiveHealth(instance, now);

  return (
    <Card
      className={`overflow-hidden border-l-4 ${HEALTH_BORDER_CLASS[health.status]}`}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{source}</CardTitle>
        <Badge variant={HEALTH_BADGE_VARIANT[health.status]}>
          {health.status}
        </Badge>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground font-mono">{instance.id}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {health.reason && health.status === "Offline" && !instance.lastSeenAt
            ? health.reason
            : `Last seen ${formatLastActive(instance.lastSeenAt)}`}
        </p>
        {instance.lastSeenAt && (
          <p
            className="text-xs text-muted-foreground/70"
            title={formatExactDate(instance.lastSeenAt)}
          >
            {formatExactDate(instance.lastSeenAt)}
          </p>
        )}
        {(instance.lastError ||
          (health.reason && health.status === "Error")) && (
          <p className="mt-1 text-xs text-red-600 dark:text-red-400">
            {instance.lastError ?? health.reason}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function SlotOccupancyRow({ snapshot }: { snapshot: RuntimeSnapshot }) {
  const total = snapshot.slotsTotal ?? 0;
  const busy = snapshot.slotsBusy ?? 0;
  const rawLabel = snapshot.payload?.label;
  const display = clientLabelDisplay(rawLabel);
  const label = rawLabel ? display.name : snapshot.instanceId;
  const port = snapshot.payload?.port;

  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="min-w-0">
        <p className="text-sm font-medium" title={display.description}>
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
        <Badge
          variant="secondary"
          className="text-xs"
          title={
            clientLabelDisplay(request.clientLabel).description ??
            request.clientLabel ??
            undefined
          }
        >
          {formatClientLabel(request.clientLabel)}
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

function RequestsByClientCard({
  rows,
  range,
  onSelectClient,
}: {
  rows: RuntimeClientVolume[];
  range: RuntimeRange;
  onSelectClient: (clientLabel: string) => void;
}) {
  const windowLabel = range === "all" ? "all time" : `last ${range}`;
  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Server className="h-4 w-4" />
          Requests by backend
        </CardTitle>
        <CardDescription>
          Inference volume by client label ({windowLabel}). These are Hermes /
          lemonade backends — not agentic Activity sources.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No inference requests in this range.
          </p>
        ) : (
          <ul className="divide-y">
            {rows.map((row) => {
              const display = clientLabelDisplay(row.clientLabel);
              const tokens = row.promptTokens + row.completionTokens;
              return (
                <li
                  key={row.clientLabel}
                  className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <button
                      type="button"
                      className="text-sm font-medium text-left hover:underline"
                      title={
                        display.description
                          ? `${display.description} (filter requests)`
                          : `Filter requests for ${row.clientLabel}`
                      }
                      onClick={() => onSelectClient(row.clientLabel)}
                    >
                      {display.name}
                    </button>
                    <p className="text-xs text-muted-foreground font-mono truncate">
                      {row.clientLabel}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold tabular-nums">
                      {row.requestCount.toLocaleString()} req
                    </p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {tokens > 0 ? `${tokens.toLocaleString()} tok` : "— tok"}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function MetricsStrip({
  metrics,
  range,
  saturated,
}: {
  metrics: RuntimeMetrics;
  range: RuntimeRange;
  saturated: boolean;
}) {
  const windowLabel = range === "all" ? "all time" : `last ${range}`;
  const cards = [
    {
      key: "slots",
      label: "Active slots",
      value: `${metrics.activeSlots}/${metrics.totalSlots}`,
      hint: saturated ? "Saturated" : "Current occupancy",
      icon: Gauge,
      alert: saturated,
    },
    {
      key: "sat",
      label: "Saturation",
      value: formatPercent(metrics.saturationRate),
      hint: "Busy / total slots",
      icon: Activity,
      alert: (metrics.saturationRate ?? 0) >= 0.9,
    },
    {
      key: "tput",
      label: "Throughput",
      value:
        metrics.requestThroughputPerHour == null
          ? "—"
          : `${formatRate(metrics.requestThroughputPerHour)}/h`,
      hint: `${metrics.requestCount} req · ${windowLabel}`,
      icon: Activity,
      alert: false,
    },
    {
      key: "cancel",
      label: "Cancellation rate",
      value: formatPercent(metrics.cancellationRate),
      hint: windowLabel,
      icon: Ban,
      alert: (metrics.cancellationRate ?? 0) >= 0.2,
    },
    {
      key: "p50",
      label: "p50 latency",
      value: formatLatency(metrics.p50LatencyMs),
      hint: windowLabel,
      icon: Timer,
      alert: false,
    },
    {
      key: "p95",
      label: "p95 latency",
      value: formatLatency(metrics.p95LatencyMs),
      hint: windowLabel,
      icon: Timer,
      alert: (metrics.p95LatencyMs ?? 0) >= 30_000,
    },
  ];

  return (
    <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
      {cards.map((c) => (
        <Card
          key={c.key}
          className={
            c.alert
              ? "border-amber-500/60 bg-amber-50/40 dark:bg-amber-950/20"
              : undefined
          }
        >
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-muted-foreground">
                {c.label}
              </p>
              <c.icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            </div>
            <p className="mt-1 text-xl font-semibold tabular-nums tracking-tight">
              {c.value}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground truncate">
              {c.hint}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function PaginationBar({
  page,
  pageSize,
  total,
  onPageChange,
  label,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  label: string;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t">
      <p className="text-xs text-muted-foreground">
        {total === 0
          ? `No ${label}`
          : `Showing ${from}–${to} of ${total} ${label}`}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label={`Previous ${label} page`}
        >
          <ChevronLeft className="h-4 w-4" />
          Prev
        </Button>
        <span className="text-xs tabular-nums text-muted-foreground min-w-[4.5rem] text-center">
          {page} / {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages || total === 0}
          onClick={() => onPageChange(page + 1)}
          aria-label={`Next ${label} page`}
        >
          Next
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export default function Runtime() {
  const [searchParams, setSearchParams] = useSearchParams();
  const now = useNow();

  const range = parseRange(searchParams.get("range"));
  const sourceId = parseOptionalFilter(searchParams.get("sourceId"));
  const reqStatus = parseOptionalFilter(searchParams.get("reqStatus"));
  const reqClient = parseOptionalFilter(searchParams.get("reqClient"));
  const reqPage = parsePage(searchParams.get("reqPage"));
  const eventKind = parseOptionalFilter(searchParams.get("eventKind"));
  const eventPage = parsePage(searchParams.get("eventPage"));

  // Normalize missing/invalid query params so the URL always reflects selection.
  useEffect(() => {
    const rawRange = searchParams.get("range");
    const rangeOk =
      rawRange === "1h" ||
      rawRange === "6h" ||
      rawRange === "24h" ||
      rawRange === "7d" ||
      rawRange === "all";
    const rawReqPage = searchParams.get("reqPage");
    const rawEventPage = searchParams.get("eventPage");
    const reqPageOk =
      rawReqPage == null ||
      (Number.isInteger(Number(rawReqPage)) && Number(rawReqPage) >= 1);
    const eventPageOk =
      rawEventPage == null ||
      (Number.isInteger(Number(rawEventPage)) && Number(rawEventPage) >= 1);

    if (rangeOk && reqPageOk && eventPageOk && rawRange != null) return;

    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("range", parseRange(prev.get("range")));
        if (!reqPageOk) next.set("reqPage", "1");
        if (!eventPageOk) next.set("eventPage", "1");
        return next;
      },
      { replace: true },
    );
  }, [searchParams, setSearchParams]);

  const updateParams = useCallback(
    (
      patch: Partial<{
        range: RuntimeRange;
        sourceId: string | undefined;
        reqStatus: string | undefined;
        reqClient: string | undefined;
        reqPage: number;
        eventKind: string | undefined;
        eventPage: number;
      }>,
      options?: { replace?: boolean },
    ) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);

          const nextRange = patch.range ?? parseRange(prev.get("range"));
          next.set("range", nextRange);

          const setOrDelete = (key: string, value: string | undefined) => {
            if (value) next.set(key, value);
            else next.delete(key);
          };

          if ("sourceId" in patch) setOrDelete("sourceId", patch.sourceId);
          if ("reqStatus" in patch) setOrDelete("reqStatus", patch.reqStatus);
          if ("reqClient" in patch) setOrDelete("reqClient", patch.reqClient);
          if ("eventKind" in patch) setOrDelete("eventKind", patch.eventKind);

          if ("reqPage" in patch && patch.reqPage != null) {
            if (patch.reqPage <= 1) next.delete("reqPage");
            else next.set("reqPage", String(patch.reqPage));
          }
          if ("eventPage" in patch && patch.eventPage != null) {
            if (patch.eventPage <= 1) next.delete("eventPage");
            else next.set("eventPage", String(patch.eventPage));
          }

          // Changing filters/range resets pages unless an explicit page was set.
          if (
            "range" in patch ||
            "sourceId" in patch ||
            "reqStatus" in patch ||
            "reqClient" in patch
          ) {
            if (!("reqPage" in patch)) next.delete("reqPage");
          }
          if ("range" in patch || "sourceId" in patch || "eventKind" in patch) {
            if (!("eventPage" in patch)) next.delete("eventPage");
          }

          return next;
        },
        { replace: options?.replace ?? true },
      );
    },
    [setSearchParams],
  );

  const queryParams: RuntimeQueryParams = useMemo(
    () => ({
      range,
      sourceId,
      reqStatus,
      reqClient,
      reqPage,
      reqLimit: DEFAULT_PAGE_SIZE,
      eventKind,
      eventPage,
      eventLimit: DEFAULT_PAGE_SIZE,
    }),
    [range, sourceId, reqStatus, reqClient, reqPage, eventKind, eventPage],
  );

  const { data, isLoading, error } = useRuntime(queryParams);

  // Clamp out-of-range pages after data shrinks (filters/time range).
  useEffect(() => {
    if (!data) return;
    const reqTotalPages = Math.max(
      1,
      Math.ceil(data.inferenceRequests.total / data.inferenceRequests.pageSize),
    );
    const eventTotalPages = Math.max(
      1,
      Math.ceil(data.runtimeEvents.total / data.runtimeEvents.pageSize),
    );
    const patch: { reqPage?: number; eventPage?: number } = {};
    if (data.inferenceRequests.total > 0 && reqPage > reqTotalPages) {
      patch.reqPage = reqTotalPages;
    }
    if (data.runtimeEvents.total > 0 && eventPage > eventTotalPages) {
      patch.eventPage = eventTotalPages;
    }
    if (Object.keys(patch).length > 0) {
      updateParams(patch);
    }
  }, [data, reqPage, eventPage, updateParams]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Runtime"
          description="Fleet-wide inference telemetry (not filtered by source)"
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
          description="Fleet-wide inference telemetry (not filtered by source)"
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
  const requests = data?.inferenceRequests ?? {
    items: [],
    total: 0,
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
  };
  const events = data?.runtimeEvents ?? {
    items: [],
    total: 0,
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
  };
  const metrics = data?.metrics ?? {
    activeSlots: 0,
    totalSlots: 0,
    saturationRate: null,
    requestThroughputPerHour: null,
    cancellationRate: null,
    p50LatencyMs: null,
    p95LatencyMs: null,
    requestCount: 0,
    since: null,
    windowHours: null,
  };
  const clientLabels = data?.filters.clientLabels ?? [];
  const requestsByClient = data?.requestsByClient ?? [];
  const showOpenCodeHint = hasOpenCodeHermesClient(clientLabels);

  const slotSnapshots = snapshots.filter((s) => s.kind === "slots");
  const modelsSnapshot = snapshots.find((s) => s.kind === "models");
  const modelsLoaded = modelsSnapshot?.modelsLoaded ?? [];
  const anyInstances = sources.some((s) => s.instances.length > 0);
  const saturated =
    metrics.totalSlots > 0 && metrics.activeSlots >= metrics.totalSlots;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Runtime"
        description="Fleet-wide inference telemetry (not filtered by source)"
      />

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">
            Time range
          </label>
          <Select
            value={range}
            onValueChange={(v) => updateParams({ range: parseRange(v) })}
          >
            <SelectTrigger className="w-[140px]" aria-label="Time range">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANGES.map((r) => (
                <SelectItem key={r} value={r}>
                  {r === "all" ? "All time" : `Last ${r}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {sources.length > 0 && (
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              Source
            </label>
            <Select
              value={sourceId ?? "all"}
              onValueChange={(v) =>
                updateParams({
                  sourceId: v === "all" ? undefined : v,
                })
              }
            >
              <SelectTrigger className="w-[160px]" aria-label="Source filter">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                {sources.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

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
          <MetricsStrip metrics={metrics} range={range} saturated={saturated} />

          {showOpenCodeHint && (
            <div
              className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground"
              role="note"
            >
              <p>
                <span className="font-medium text-foreground">
                  {formatClientLabel("opencode")}
                </span>{" "}
                in the Client filter and request table is Hermes/llama-swap
                backend inference for the OpenCode-dedicated slot — not OpenCode
                agent sessions (Activities / Sessions). Filter or open{" "}
                <button
                  type="button"
                  className="font-medium text-foreground underline-offset-2 hover:underline"
                  onClick={() =>
                    updateParams({
                      reqClient: "opencode",
                      reqPage: 1,
                    })
                  }
                >
                  OpenCode backend requests
                </button>{" "}
                to inspect that traffic.
              </p>
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-1">
              <RequestsByClientCard
                rows={requestsByClient}
                range={range}
                onSelectClient={(clientLabel) =>
                  updateParams({
                    reqClient: clientLabel,
                    reqPage: 1,
                  })
                }
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:col-span-2 content-start">
              {sources.flatMap((source) =>
                source.instances.map((instance) => (
                  <InstanceHealthCard
                    key={instance.id}
                    source={source.name}
                    instance={instance}
                    now={now}
                  />
                )),
              )}
            </div>
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
            <CardContent className="divide-y max-h-64 overflow-y-auto">
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
                <div className="grid gap-3 sm:grid-cols-2 max-h-64 overflow-y-auto">
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
            <CardHeader className="pb-4 border-b space-y-3">
              <div>
                <CardTitle className="text-lg">Recent Requests</CardTitle>
                <CardDescription>
                  Workload is a best-effort heuristic — badged distinctly from
                  verified fields, not ground truth
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    Status
                  </label>
                  <Select
                    value={reqStatus ?? "all"}
                    onValueChange={(v) =>
                      updateParams({
                        reqStatus: v === "all" ? undefined : v,
                      })
                    }
                  >
                    <SelectTrigger
                      className="w-[160px]"
                      aria-label="Request status filter"
                    >
                      <SelectValue placeholder="All" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      {REQUEST_STATUSES.map((s) => (
                        <SelectItem key={s} value={s} className="capitalize">
                          {s.replace(/_/g, " ")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    Backend
                  </label>
                  <Select
                    value={reqClient ?? "all"}
                    onValueChange={(v) =>
                      updateParams({
                        reqClient: v === "all" ? undefined : v,
                      })
                    }
                  >
                    <SelectTrigger
                      className="w-[220px]"
                      aria-label="Request backend filter"
                    >
                      <SelectValue placeholder="All" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All backends</SelectItem>
                      {clientLabels.map((c) => (
                        <SelectItem key={c} value={c} title={c}>
                          {formatClientLabel(c)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0 px-0">
              {requests.items.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No inference requests
                  {reqStatus || reqClient
                    ? " match the current filters."
                    : " observed yet."}
                </p>
              ) : (
                <div className="overflow-x-auto max-h-[28rem] overflow-y-auto">
                  <table className="w-full">
                    <thead className="sticky top-0 bg-background z-10">
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
                      {requests.items.map((r) => (
                        <InferenceRequestRow key={r.id} request={r} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <PaginationBar
                page={requests.page}
                pageSize={requests.pageSize}
                total={requests.total}
                label="requests"
                onPageChange={(p) => updateParams({ reqPage: p })}
              />
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="space-y-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                Runtime Events
              </CardTitle>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Event type
                </label>
                <Select
                  value={eventKind ?? "all"}
                  onValueChange={(v) =>
                    updateParams({
                      eventKind: v === "all" ? undefined : v,
                    })
                  }
                >
                  <SelectTrigger
                    className="w-[200px]"
                    aria-label="Event type filter"
                  >
                    <SelectValue placeholder="All" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    {EVENT_KINDS.map((k) => (
                      <SelectItem key={k} value={k} className="capitalize">
                        {k.replace(/_/g, " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent className="pt-0 px-0">
              <div className="divide-y max-h-80 overflow-y-auto px-6">
                {events.items.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    {eventKind
                      ? "No events match the current filters."
                      : "No runtime events — no saturation, outages, or overflows observed yet."}
                  </p>
                ) : (
                  events.items.map((e) => (
                    <RuntimeEventRow key={e.id} event={e} />
                  ))
                )}
              </div>
              <PaginationBar
                page={events.page}
                pageSize={events.pageSize}
                total={events.total}
                label="events"
                onPageChange={(p) => updateParams({ eventPage: p })}
              />
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
