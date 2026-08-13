import { Badge } from "@/components/ui/badge";
import type { ProviderCredit } from "@/lib/queries";

function formatCreditRemaining(c: ProviderCredit): string {
  if (c.remaining == null) {
    if (c.status === "unavailable" || c.status === "limited") {
      return "—";
    }
    return "—";
  }
  if (c.unit === "usd") return `$${c.remaining.toFixed(2)}`;
  if (c.unit === "percent") return `${c.remaining.toFixed(0)}% left`;
  if (c.unit === "tokens") return `${c.remaining.toLocaleString()} tokens`;
  if (c.unit === "requests") return `${c.remaining.toLocaleString()} req`;
  return `${c.remaining.toLocaleString()} ${c.unit}`;
}

function creditLabelDisplay(label: string): string {
  if (label === "prepaid_balance") return "Wallet balance";
  if (label === "plan_usage_unavailable") return "Plan limits";
  if (label.startsWith("quota_")) {
    return label.replace(/^quota_/, "Usage window · ").replace(/_/g, " ");
  }
  return label;
}

function creditStatusBadgeVariant(
  status: string,
): "default" | "destructive" | "secondary" | "outline" {
  if (status === "ok") return "default";
  if (status === "error") return "destructive";
  // stale / expired must never look green/actionable
  if (status === "expired" || status === "stale") return "outline";
  return "secondary";
}

function isCreditFreshnessDemoted(status: string): boolean {
  return status === "expired" || status === "stale";
}

export function CreditSnapshotTile({ credit }: { credit: ProviderCredit }) {
  const freshnessReason =
    typeof credit.details?.freshnessReason === "string"
      ? credit.details.freshnessReason
      : null;
  const note =
    freshnessReason ??
    (typeof credit.details?.note === "string"
      ? credit.details.note
      : typeof credit.details?.productLanguage === "string"
        ? credit.details.productLanguage
        : null);
  const demoted = isCreditFreshnessDemoted(credit.status);

  return (
    <div
      className={`rounded-md border px-3 py-2.5 space-y-1 ${
        demoted ? "opacity-80 border-dashed" : ""
      }`}
      data-testid={`credit-${credit.provider}-${credit.label}`}
      data-credit-status={credit.status}
      title={note ?? undefined}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium capitalize">
          {credit.provider}
        </span>
        <Badge variant={creditStatusBadgeVariant(credit.status)}>
          {credit.status}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        {creditLabelDisplay(credit.label)}
        {credit.source === "session_quota" ? " · session quota" : ""}
        {credit.source === "provider_api" ? " · provider API" : ""}
        {credit.source === "unavailable" ? " · not available" : ""}
      </p>
      <p
        className={`text-lg font-semibold tabular-nums ${
          demoted
            ? "text-muted-foreground line-through decoration-muted-foreground/60"
            : ""
        }`}
      >
        {formatCreditRemaining(credit)}
      </p>
      {demoted && (
        <p
          className="text-xs text-muted-foreground"
          data-testid="credit-freshness-reason"
        >
          {freshnessReason ??
            (credit.status === "expired"
              ? "Quota window expired — not actionable."
              : "Snapshot is stale — re-sync or collect a new session.")}
        </p>
      )}
      <p className="text-[11px] text-muted-foreground">
        as of {new Date(credit.asOf).toLocaleString()}
      </p>
    </div>
  );
}
