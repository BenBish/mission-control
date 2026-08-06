import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import { useFilterableSourceId, useSourceFilter } from "@/app/source-context";
import { scopePhrase } from "@/config/sourceScope";
import {
  updateFailureIncident,
  useFailureGroupEvents,
  useFailureGroups,
} from "@/lib/queries";
import {
  failureStatusScopeLabel,
  type FailureGroup,
  type FailureItem,
  type FailureKind,
  type FailureResolution,
  type FailureSignalClass,
  type FailureTriageStatus,
} from "@/types/failures";

const KIND_LABEL: Record<FailureKind, string> = {
  activity: "Activity",
  inference_request: "Inference",
  runtime_event: "Runtime",
};

const SIGNAL_LABEL: Record<FailureSignalClass, string> = {
  actionable: "Actionable",
  expected: "Expected",
  transient: "Transient",
};

const TRIAGE_LABEL: Record<FailureTriageStatus, string> = {
  open: "Open",
  acknowledged: "Acknowledged",
  snoozed: "Snoozed",
  resolved: "Resolved",
};

const PAGE_SIZE = 25;

function formatRelativeTime(timestamp: string): string {
  const diffMs = new Date().getTime() - new Date(timestamp).getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function formatAbsolute(timestamp: string): string {
  try {
    return new Date(timestamp).toLocaleString();
  } catch {
    return timestamp;
  }
}

function looksLikeJson(text: string): boolean {
  const t = text.trim();
  return (
    (t.startsWith("{") && t.endsWith("}")) ||
    (t.startsWith("[") && t.endsWith("]"))
  );
}

function TechnicalDetails({ detail }: { detail: string }) {
  const [open, setOpen] = useState(false);
  const pretty = useMemo(() => {
    if (!looksLikeJson(detail)) return detail;
    try {
      return JSON.stringify(JSON.parse(detail), null, 2);
    } catch {
      return detail;
    }
  }, [detail]);

  return (
    <div className="mt-1">
      <button
        type="button"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        {open ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        {open ? "Hide technical details" : "Show technical details"}
      </button>
      {open && (
        <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-muted/60 p-2 text-xs whitespace-pre-wrap break-all">
          {pretty}
        </pre>
      )}
    </div>
  );
}

function signalBadgeVariant(
  signal: FailureSignalClass,
): "destructive" | "secondary" | "warning" {
  if (signal === "actionable") return "destructive";
  if (signal === "transient") return "warning";
  return "secondary";
}

function triageBadgeVariant(
  status: FailureTriageStatus,
): "destructive" | "secondary" | "success" | "info" | "warning" {
  switch (status) {
    case "open":
      return "destructive";
    case "acknowledged":
      return "info";
    case "snoozed":
      return "warning";
    case "resolved":
      return "success";
  }
}

const OCCURRENCE_PAGE_SIZE = 20;

function GroupOccurrences({
  group,
  sourceId,
}: {
  group: FailureGroup;
  sourceId?: string;
}) {
  const navigate = useNavigate();
  const [occPage, setOccPage] = useState(1);
  const { data, isLoading, error } = useFailureGroupEvents(group.fingerprint, {
    limit: OCCURRENCE_PAGE_SIZE,
    offset: (occPage - 1) * OCCURRENCE_PAGE_SIZE,
    sourceId,
    enabled: true,
  });

  if (isLoading) {
    return (
      <p className="text-xs text-muted-foreground py-2">Loading occurrences…</p>
    );
  }
  if (error) {
    return (
      <p className="text-xs text-destructive py-2">
        {error instanceof Error ? error.message : "Failed to load occurrences"}
      </p>
    );
  }

  const events = data?.events ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / OCCURRENCE_PAGE_SIZE));
  const from = total === 0 ? 0 : (occPage - 1) * OCCURRENCE_PAGE_SIZE + 1;
  const to = Math.min(occPage * OCCURRENCE_PAGE_SIZE, total);

  return (
    <div className="mt-2 border-t border-border/60 pt-2 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Occurrences {from.toLocaleString()}–{to.toLocaleString()} of{" "}
          {total.toLocaleString()}
        </p>
        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2"
              disabled={occPage <= 1}
              onClick={(e) => {
                e.stopPropagation();
                setOccPage((p) => Math.max(1, p - 1));
              }}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="text-xs tabular-nums text-muted-foreground px-1">
              {occPage}/{totalPages}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2"
              disabled={occPage >= totalPages}
              onClick={(e) => {
                e.stopPropagation();
                setOccPage((p) => Math.min(totalPages, p + 1));
              }}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>
      <ul className="space-y-2">
        {events.map((ev: FailureItem) => (
          <li
            key={`${ev.kind}:${ev.id}`}
            className={`rounded-md bg-muted/40 px-3 py-2 text-sm ${
              ev.kind === "activity" ? "cursor-pointer hover:bg-muted/70" : ""
            }`}
            onClick={() =>
              ev.kind === "activity" && navigate(`/activities/${ev.id}`)
            }
          >
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span title={formatAbsolute(ev.timestamp)}>
                {formatRelativeTime(ev.timestamp)}
              </span>
              <Badge
                variant={ev.resolved ? "secondary" : "destructive"}
                className="text-[10px]"
              >
                {ev.resolved ? "resolved" : "open"}
              </Badge>
              {ev.signalClass && (
                <Badge
                  variant={signalBadgeVariant(ev.signalClass)}
                  className="text-[10px]"
                >
                  {SIGNAL_LABEL[ev.signalClass]}
                </Badge>
              )}
              <span className="font-mono text-[10px] truncate max-w-[12rem]">
                {ev.id}
              </span>
            </div>
            <p className="mt-0.5 text-sm">{ev.summary}</p>
            {ev.detail && <TechnicalDetails detail={ev.detail} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

function IncidentTriagePanel({
  group,
  onUpdated,
}: {
  group: FailureGroup;
  onUpdated: () => void;
}) {
  const [owner, setOwner] = useState(group.owner ?? "");
  const [reason, setReason] = useState(group.resolutionReason ?? "");
  const [runbook, setRunbook] = useState(group.runbookUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (
      patch: Parameters<typeof updateFailureIncident>[1],
      opts?: { requireReason?: boolean },
    ) => {
      if (opts?.requireReason && !reason.trim()) {
        setError("Resolution reason is required");
        return;
      }
      setBusy(true);
      setError(null);
      try {
        await updateFailureIncident(group.fingerprint, {
          ...patch,
          owner: owner.trim() || null,
          resolutionReason: reason.trim() || null,
          runbookUrl: runbook.trim() || null,
        });
        onUpdated();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Update failed");
      } finally {
        setBusy(false);
      }
    },
    [group.fingerprint, owner, reason, runbook, onUpdated],
  );

  return (
    <div
      className="mt-3 rounded-md border bg-background/80 p-3 space-y-3"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          Incident triage
        </span>
        <Badge
          variant={triageBadgeVariant(group.triageStatus)}
          className="text-[10px]"
        >
          {TRIAGE_LABEL[group.triageStatus]}
        </Badge>
        {group.owner && (
          <span className="text-xs text-muted-foreground">
            Owner: {group.owner}
          </span>
        )}
        {group.snoozedUntil && group.triageStatus === "snoozed" && (
          <span className="text-xs text-muted-foreground">
            Until {formatAbsolute(group.snoozedUntil)}
          </span>
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">Owner</label>
          <Input
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            placeholder="operator@"
            className="h-8 text-xs"
            disabled={busy}
          />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">
            Resolution reason
          </label>
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why this is resolved"
            className="h-8 text-xs"
            disabled={busy}
          />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">
            Runbook / link
          </label>
          <Input
            value={runbook}
            onChange={(e) => setRunbook(e.target.value)}
            placeholder="https://…"
            className="h-8 text-xs"
            disabled={busy}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => run({ triageStatus: "acknowledged" })}
        >
          Acknowledge
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            run({
              triageStatus: "snoozed",
              snoozedUntil: new Date(
                Date.now() + 24 * 60 * 60 * 1000,
              ).toISOString(),
            })
          }
        >
          Snooze 24h
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => run({ owner: owner.trim() || null })}
        >
          Save owner
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={busy}
          onClick={() =>
            run(
              {
                triageStatus: "resolved",
                resolutionReason: reason.trim(),
                runbookUrl: runbook.trim() || null,
              },
              { requireReason: true },
            )
          }
        >
          Resolve
        </Button>
        {group.triageStatus !== "open" && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => run({ triageStatus: "open", snoozedUntil: null })}
          >
            Re-open
          </Button>
        )}
      </div>

      {group.resolutionReason && (
        <p className="text-xs text-muted-foreground">
          Reason: {group.resolutionReason}
          {group.runbookUrl && (
            <>
              {" · "}
              <a
                href={group.runbookUrl}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2"
              >
                Runbook
              </a>
            </>
          )}
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function GroupRow({
  group,
  sourceId,
  onTriageUpdated,
}: {
  group: FailureGroup;
  sourceId?: string;
  onTriageUpdated: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <tr className="border-b last:border-0 align-top hover:bg-muted/40">
      <td className="py-3 px-4 text-sm text-muted-foreground whitespace-nowrap">
        <div title={formatAbsolute(group.lastSeen)}>
          {formatRelativeTime(group.lastSeen)}
        </div>
        <div
          className="text-[11px] text-muted-foreground/80"
          title={formatAbsolute(group.firstSeen)}
        >
          first {formatRelativeTime(group.firstSeen)}
        </div>
      </td>
      <td className="py-3 px-4 text-sm">
        <Badge variant="secondary" className="text-xs">
          {group.sourceId}
        </Badge>
      </td>
      <td className="py-3 px-4 text-sm text-muted-foreground">
        {KIND_LABEL[group.kind] ?? group.kind}
      </td>
      <td className="py-3 px-4 text-sm tabular-nums font-medium">
        {group.occurrenceCount.toLocaleString()}
      </td>
      <td className="py-3 px-4 text-sm space-y-1">
        <div className="flex flex-wrap gap-1">
          <Badge
            variant={signalBadgeVariant(group.signalClass)}
            className="text-xs"
          >
            {SIGNAL_LABEL[group.signalClass]}
          </Badge>
          <Badge
            variant={triageBadgeVariant(group.triageStatus)}
            className="text-xs"
          >
            {TRIAGE_LABEL[group.triageStatus]}
          </Badge>
        </div>
        <Badge
          variant={group.resolved ? "secondary" : "outline"}
          className="text-[10px]"
        >
          {group.resolved
            ? "events closed"
            : group.openCount > 0
              ? `${group.openCount} open events`
              : "open events"}
        </Badge>
      </td>
      <td className="py-3 px-4 text-sm max-w-md">
        <button
          type="button"
          className="flex w-full items-start gap-1 text-left"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0">
            <span className="block truncate">{group.summary}</span>
            {!expanded && group.detail && (
              <span className="text-xs text-muted-foreground">
                Technical details available
              </span>
            )}
            {!expanded && group.owner && (
              <span className="block text-xs text-muted-foreground">
                Owner {group.owner}
              </span>
            )}
          </span>
        </button>
        {expanded && (
          <div className="mt-2 pl-5">
            {group.detail && <TechnicalDetails detail={group.detail} />}
            <IncidentTriagePanel
              key={`${group.fingerprint}:${group.triageStatus}:${group.owner ?? ""}:${group.resolutionReason ?? ""}:${group.runbookUrl ?? ""}`}
              group={group}
              onUpdated={onTriageUpdated}
            />
            <GroupOccurrences group={group} sourceId={sourceId} />
          </div>
        )}
      </td>
    </tr>
  );
}

export default function FailureAnalysis() {
  const { sources } = useSourceFilter();
  const selectedSourceId = useFilterableSourceId();
  const pageDescription = `Grouped failures ${scopePhrase(selectedSourceId, sources)}`;
  const queryClient = useQueryClient();

  const [kind, setKind] = useState<FailureKind | "">("");
  const [resolved, setResolved] = useState<FailureResolution | "">("");
  const [signalClass, setSignalClass] = useState<FailureSignalClass | "">("");
  const [triageStatus, setTriageStatus] = useState<FailureTriageStatus | "">(
    "",
  );
  const [page, setPage] = useState(1);
  // Reset pagination when the global source filter changes (render-time adjust).
  const [pageSourceId, setPageSourceId] = useState(selectedSourceId);
  if (pageSourceId !== selectedSourceId) {
    setPageSourceId(selectedSourceId);
    setPage(1);
  }

  const updateKind = useCallback((value: string) => {
    setKind(value === "all" ? "" : (value as FailureKind));
    setPage(1);
  }, []);

  const updateResolved = useCallback((value: string) => {
    setResolved(value === "all" ? "" : (value as FailureResolution));
    setPage(1);
  }, []);

  const updateSignal = useCallback((value: string) => {
    setSignalClass(value === "all" ? "" : (value as FailureSignalClass));
    setPage(1);
  }, []);

  const updateTriage = useCallback((value: string) => {
    setTriageStatus(value === "all" ? "" : (value as FailureTriageStatus));
    setPage(1);
  }, []);

  const clearFilters = useCallback(() => {
    setKind("");
    setResolved("");
    setSignalClass("");
    setTriageStatus("");
    setPage(1);
  }, []);

  const hasLocalFilters =
    kind !== "" || resolved !== "" || signalClass !== "" || triageStatus !== "";

  const {
    data: groupsData,
    isLoading,
    error,
  } = useFailureGroups({
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
    sourceId: selectedSourceId,
    kind,
    resolved,
    signalClass,
    triageStatus,
  });

  const invalidateGroups = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["failures"] });
  }, [queryClient]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Failure Analysis" description={pageDescription} />
        <Loading />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Failure Analysis" description={pageDescription} />
        <Card className="border-destructive">
          <CardContent className="py-6">
            <p className="font-medium text-destructive">Error</p>
            <p className="text-sm text-muted-foreground">
              {error instanceof Error ? error.message : "Unknown error"}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const groups = groupsData?.groups ?? [];
  const groupTotal = groupsData?.groupTotal ?? 0;
  const summary = groupsData?.summary;
  if (!summary) {
    return (
      <div className="space-y-6">
        <PageHeader title="Failure Analysis" description={pageDescription} />
        <Card className="border-destructive">
          <CardContent className="py-6">
            <p className="font-medium text-destructive">Error</p>
            <p className="text-sm text-muted-foreground">
              Failures API response missing summary aggregates
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const total = summary.total;
  const last24Hours = summary.last24Hours;
  const openRuntime = summary.openRuntimeEvents;
  const sq = summary.signalQuality;
  const scopeLabel = failureStatusScopeLabel(summary);
  const totalPages = Math.max(1, Math.ceil(groupTotal / PAGE_SIZE));
  const showingFrom = groupTotal === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const showingTo = Math.min(page * PAGE_SIZE, groupTotal);

  return (
    <div className="space-y-6">
      <PageHeader title="Failure Analysis" description={pageDescription} />

      <div className="flex flex-wrap gap-4">
        <Card className="overflow-hidden border-l-4 border-l-red-500 sm:w-56">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Failures
            </CardTitle>
            <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/30">
              <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tracking-tight tabular-nums">
              {total.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              All time · {scopeLabel}
            </p>
          </CardContent>
        </Card>

        <Card className="overflow-hidden border-l-4 border-l-orange-500 sm:w-56">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Last 24 Hours
            </CardTitle>
            <div className="p-2 rounded-lg bg-orange-100 dark:bg-orange-900/30">
              <AlertTriangle className="h-4 w-4 text-orange-600 dark:text-orange-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tracking-tight tabular-nums">
              {last24Hours.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Last 24 hours · {scopeLabel}
            </p>
          </CardContent>
        </Card>

        {openRuntime > 0 && (
          <Card className="overflow-hidden border-l-4 border-l-amber-500 sm:w-56">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Open Runtime
              </CardTitle>
              <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold tracking-tight tabular-nums">
                {openRuntime.toLocaleString()}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Unresolved · severity ≠ info, no end time
              </p>
            </CardContent>
          </Card>
        )}

        <Card className="overflow-hidden border-l-4 border-l-slate-400 sm:w-56">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Unique Groups
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tracking-tight tabular-nums">
              {(sq?.groupCount ?? groupTotal).toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Kind/source scope (not signal/triage filters) ·{" "}
              {sq
                ? `${sq.avgEventsPerGroup} events/group`
                : "signal quality pending"}
              {groupTotal !== (sq?.groupCount ?? groupTotal) && (
                <>
                  {" · "}
                  table shows {groupTotal.toLocaleString()} after filters
                </>
              )}
            </p>
          </CardContent>
        </Card>

        {sq && (
          <>
            <Card className="overflow-hidden border-l-4 border-l-violet-500 sm:w-56">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Recurring
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold tracking-tight tabular-nums">
                  {sq.recurringGroups.toLocaleString()}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  2+ occurrences · kind/source scope
                </p>
              </CardContent>
            </Card>

            <Card className="overflow-hidden border-l-4 border-l-rose-500 sm:w-56">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Untriaged actionable
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold tracking-tight tabular-nums">
                  {sq.untriagedActionableGroups.toLocaleString()}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Actionable + open triage · kind/source scope
                </p>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <Card className="shadow-sm">
        <CardContent className="pt-4 flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              Kind
            </label>
            <Select value={kind || "all"} onValueChange={updateKind}>
              <SelectTrigger className="w-[11rem]">
                <SelectValue placeholder="All kinds" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All kinds</SelectItem>
                <SelectItem value="activity">Activity</SelectItem>
                <SelectItem value="inference_request">Inference</SelectItem>
                <SelectItem value="runtime_event">Runtime</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              Signal
            </label>
            <Select value={signalClass || "all"} onValueChange={updateSignal}>
              <SelectTrigger className="w-[11rem]">
                <SelectValue placeholder="All signals" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All signals</SelectItem>
                <SelectItem value="actionable">Actionable</SelectItem>
                <SelectItem value="expected">Expected</SelectItem>
                <SelectItem value="transient">Transient</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              Triage
            </label>
            <Select value={triageStatus || "all"} onValueChange={updateTriage}>
              <SelectTrigger className="w-[11rem]">
                <SelectValue placeholder="All triage" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All triage</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="acknowledged">Acknowledged</SelectItem>
                <SelectItem value="snoozed">Snoozed</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              Events
            </label>
            <Select value={resolved || "all"} onValueChange={updateResolved}>
              <SelectTrigger className="w-[11rem]">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All events</SelectItem>
                <SelectItem value="unresolved">Open events</SelectItem>
                <SelectItem value="resolved">Closed events</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {hasLocalFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              className="gap-1"
            >
              <X className="h-3.5 w-3.5" />
              Clear filters
            </Button>
          )}
          <p className="text-xs text-muted-foreground ml-auto max-w-sm text-right">
            Source filter is global (header). Groups share a fingerprint of
            kind, source, structured fields, and normalized message. Triage
            state is stored separately from raw events.
          </p>
        </CardContent>
      </Card>

      {total === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <div className="flex flex-col items-center gap-2">
              <AlertTriangle className="h-12 w-12 text-muted-foreground/30" />
              <p className="text-muted-foreground">No failures found.</p>
              <p className="text-sm text-muted-foreground">
                Failures will appear here when activities, inference requests,
                or runtime events fail.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : groupTotal === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              No failure groups match the current filters.
            </p>
            {hasLocalFilters && (
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={clearFilters}
              >
                Clear filters
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card className="shadow-sm">
          <CardContent className="pt-4 px-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Last / First
                    </th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Source
                    </th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Kind
                    </th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Count
                    </th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Signal / Triage
                    </th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Summary
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <GroupRow
                      key={g.fingerprint}
                      group={g}
                      sourceId={selectedSourceId}
                      onTriageUpdated={invalidateGroups}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t text-xs text-muted-foreground">
              <p>
                Groups {showingFrom.toLocaleString()}–
                {showingTo.toLocaleString()} of {groupTotal.toLocaleString()}
                {" · "}
                {total.toLocaleString()} events total ({summary.byKind.activity}{" "}
                activity · {summary.byKind.inference_request} inference ·{" "}
                {summary.byKind.runtime_event} runtime)
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Prev
                </Button>
                <span className="tabular-nums">
                  {page} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
