import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSourceFilter } from "@/app/source-context";

const STATUS_COLOR: Record<string, string> = {
  ok: "bg-green-500",
  off: "bg-muted-foreground/40",
  error: "bg-red-500",
  unknown: "bg-amber-500",
};

export function SourceFilter() {
  const { sources, isLoading, error, selectedSourceId, setSelectedSourceId } =
    useSourceFilter();

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

  return (
    <Select
      value={selectedSourceId ?? "all"}
      onValueChange={(v) => setSelectedSourceId(v === "all" ? undefined : v)}
    >
      <SelectTrigger className="h-9 w-44 gap-2 text-sm">
        <SelectValue placeholder="All sources">
          <span className="flex items-center gap-2">
            {selected && (
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  STATUS_COLOR[selected.instances[0]?.status ?? "unknown"]
                }`}
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
              {source.instances.map((instance) => (
                <span
                  key={instance.id}
                  className={`inline-block h-2 w-2 rounded-full flex-shrink-0 ${STATUS_COLOR[instance.status] ?? STATUS_COLOR.unknown}`}
                  title={`${instance.id}: ${instance.status}`}
                />
              ))}
              <span className="truncate">{source.name}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
