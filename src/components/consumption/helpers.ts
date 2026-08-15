import type { MatchClassification } from "@/lib/queries";
import type { DatePreset } from "@/lib/date-range";
import type { ConsumptionView, Unit } from "./types";

export function parseView(raw: string | null): ConsumptionView {
  if (raw === "plan-wallet") return "plan-wallet";
  if (raw === "direct-api") return "direct-api";
  if (raw === "attribution") return "attribution";
  return "agent";
}

export function classificationBadgeVariant(
  c: MatchClassification,
): "default" | "secondary" | "destructive" | "outline" {
  if (c === "exact" || c === "likely") return "default";
  if (c === "duplicate_risk" || c === "ambiguous") return "destructive";
  if (c === "unmatched_provider") return "secondary";
  return "outline";
}

export function classificationLabel(c: MatchClassification): string {
  switch (c) {
    case "exact":
      return "Exact";
    case "likely":
      return "Likely";
    case "ambiguous":
      return "Ambiguous";
    case "duplicate_risk":
      return "Duplicate risk";
    case "unmatched_provider":
      return "Unmatched spend";
    case "unmatched_agent":
      return "Usage without cost";
  }
}

export function parseRange(raw: string | null): DatePreset {
  if (raw === "today" || raw === "7d" || raw === "30d" || raw === "all") {
    return raw;
  }
  return "30d";
}

export function parseUnit(raw: string | null): Unit {
  if (raw === "tokens" || raw === "compute" || raw === "usd") return raw;
  return "tokens";
}

export function formatCompute(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${minutes.toFixed(1)}m`;
  return `${(minutes / 60).toFixed(1)}h`;
}

export function statusBadgeVariant(
  status: string,
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "ok") return "default";
  if (status === "error") return "destructive";
  if (status === "limited" || status === "syncing") return "secondary";
  return "outline";
}
