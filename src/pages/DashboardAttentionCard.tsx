import { Link } from "react-router-dom";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { DashboardAttentionItem } from "@/lib/dashboard-attention";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  DollarSign,
  Sparkles,
  Target,
  Wallet,
} from "lucide-react";

const KIND_ICON = {
  failure: AlertCircle,
  "plan-usage": Target,
  wallet: Wallet,
  budget: DollarSign,
  anomaly: AlertTriangle,
  "spend-mover": Sparkles,
} as const;

const SEVERITY_ICON = {
  critical: "text-red-600 dark:text-red-400",
  warn: "text-amber-700 dark:text-amber-400",
  info: "text-blue-600 dark:text-blue-400",
} as const;

const SEVERITY_BG = {
  critical: "bg-red-100 dark:bg-red-900/30",
  warn: "bg-amber-100 dark:bg-amber-900/30",
  info: "bg-blue-100 dark:bg-blue-900/30",
} as const;

export function DashboardAttentionCard({
  items,
}: {
  items: DashboardAttentionItem[];
}) {
  const hasRisk = items.some(
    (item) => item.severity === "critical" || item.severity === "warn",
  );

  return (
    <Card
      className={`min-w-0 overflow-hidden shadow-sm ${
        hasRisk ? "border-l-4 border-l-amber-500" : ""
      }`}
      data-testid="dashboard-attention"
    >
      <CardHeader className="pb-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="shrink-0 rounded-lg bg-amber-500/10 p-2 dark:bg-amber-500/20">
            <Sparkles className="h-4 w-4 text-amber-700 dark:text-amber-400" />
          </div>
          <div className="min-w-0">
            <CardTitle className="text-lg">Needs attention</CardTitle>
            <CardDescription>
              Meaningful changes and recommended actions — not individual tool
              calls
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <Separator />
      <CardContent className="min-w-0 pt-4">
        {items.length === 0 ? (
          <div
            className="flex items-start gap-3 text-sm text-muted-foreground"
            data-testid="dashboard-attention-empty"
          >
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <p>
              All clear — no new failures, capacity risks, or notable spend
              movers.
            </p>
          </div>
        ) : (
          <ul className="min-w-0 space-y-1">
            {items.map((item) => {
              const Icon = KIND_ICON[item.kind];
              return (
                <li key={item.id} className="min-w-0">
                  <Link
                    to={item.href}
                    className="group flex min-w-0 items-start gap-3 rounded-lg p-3 outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
                    data-testid="dashboard-attention-item"
                    data-kind={item.kind}
                    data-severity={item.severity}
                  >
                    <div
                      className={`shrink-0 rounded-md p-1.5 ${SEVERITY_BG[item.severity]}`}
                    >
                      <Icon
                        className={`h-4 w-4 ${SEVERITY_ICON[item.severity]}`}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium group-hover:text-primary">
                        {item.title}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {item.detail}
                      </p>
                    </div>
                    <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
