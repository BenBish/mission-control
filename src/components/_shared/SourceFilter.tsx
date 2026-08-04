import { useLocation } from "react-router-dom";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSourceFilter } from "@/app/source-context";
import { getRouteScope } from "@/config/sourceScope";
import { useNow } from "@/hooks/useNow";
import {
  formatInstanceHealthTooltip,
  getEffectiveHealth,
  HEALTH_DOT_CLASS,
  type HealthStatus,
} from "@/services/sourceHealth";

function instanceDotClass(status: HealthStatus | undefined): string {
  return HEALTH_DOT_CLASS[status ?? "Unknown"];
}

export function SourceFilter() {
  const location = useLocation();
  const scope = getRouteScope(location.pathname);
  const disabled = scope.mode === "unscoped";
  const { sources, isLoading, error, selectedSourceId, setSelectedSourceId } =
    useSourceFilter();
  // Age-based health must tick even when source payloads are unchanged.
  const now = useNow();

  if (isLoading) {
    return <div className="h-9 w-40 animate-pulse rounded-md bg-muted" />;
  }

  if (error && sources.length === 0) {
    return (
      <div
        className="flex h-9 w-44 items-center gap-2 rounded-md border border-border px-3 text-sm text-muted-foreground"
        title={error}
      >
        <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
        <span className="truncate">Failed to load</span>
      </div>
    );
  }

  const selected = sources.find((s) => s.id === selectedSourceId);
  const selectedPrimary = selected?.instances[0];
  const selectedHealth = selectedPrimary
    ? getEffectiveHealth(selectedPrimary, now)
    : undefined;
  const title = disabled
    ? (scope.reason ?? "Source filter not applied on this page")
    : scope.mode === "mixed"
      ? (scope.note ?? "Some sections on this page are account-wide")
      : undefined;

  return (
    <div
      className="flex items-center gap-2"
      title={title}
      data-testid="source-filter"
    >
      <Select
        value={selectedSourceId ?? "all"}
        onValueChange={(v) => setSelectedSourceId(v === "all" ? undefined : v)}
        disabled={disabled}
      >
        <SelectTrigger
          className="h-9 w-44 gap-2 text-sm"
          aria-label="Filter by source"
          data-testid="source-filter-trigger"
        >
          <SelectValue placeholder="All sources">
            <span className="flex items-center gap-2">
              {selectedPrimary && selectedHealth && (
                <span
                  className={`inline-block h-2 w-2 rounded-full ${instanceDotClass(selectedHealth.status)}`}
                  title={formatInstanceHealthTooltip(
                    selectedPrimary.id,
                    selectedHealth,
                    selectedPrimary.status,
                  )}
                />
              )}
              <span className="truncate">
                {selected ? selected.name : "All sources"}
              </span>
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All sources</SelectItem>
          {sources.map((source) => (
            <SelectItem key={source.id} value={source.id}>
              <span className="flex items-center gap-2">
                {source.instances.map((instance) => {
                  const health = getEffectiveHealth(instance, now);
                  return (
                    <span
                      key={instance.id}
                      className={`inline-block h-2 w-2 rounded-full flex-shrink-0 ${instanceDotClass(health.status)}`}
                      title={formatInstanceHealthTooltip(
                        instance.id,
                        health,
                        instance.status,
                      )}
                      aria-label={`${instance.id}: ${health.status}`}
                    />
                  );
                })}
                <span className="truncate">{source.name}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {disabled && (
        <span className="text-xs text-muted-foreground max-w-[7rem] sm:max-w-[10rem] truncate">
          Not filtered
        </span>
      )}
      {scope.mode === "mixed" && selectedSourceId && (
        <span className="text-xs text-muted-foreground max-w-[7rem] sm:max-w-[10rem] truncate">
          Partial scope
        </span>
      )}
    </div>
  );
}
