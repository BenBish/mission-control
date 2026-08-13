import { Fragment, type Dispatch, type SetStateAction } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loading } from "@/components/_shared/Loading";
import { Info, AlertTriangle, ChevronDown } from "lucide-react";
import type { ByokTreatment, SpendReconciliation } from "@/lib/queries";
import { PROVIDER_FILTER_OPTIONS, BYOK_OPTIONS } from "./constants";
import { classificationBadgeVariant, classificationLabel } from "./helpers";

export function AttributionTab({
  selectedSourceId,
  agentScope,
  includedProviders,
  setIncludedProviders,
  byokTreatment,
  setByokTreatment,
  reconLoading,
  reconError,
  reconciliation,
  expandedMatchKey,
  setExpandedMatchKey,
}: {
  selectedSourceId: string | undefined;
  agentScope: string;
  includedProviders: string[] | null;
  setIncludedProviders: Dispatch<SetStateAction<string[] | null>>;
  byokTreatment: ByokTreatment;
  setByokTreatment: Dispatch<SetStateAction<ByokTreatment>>;
  reconLoading: boolean;
  reconError: Error | null;
  reconciliation: SpendReconciliation | undefined;
  expandedMatchKey: string | null;
  setExpandedMatchKey: Dispatch<SetStateAction<string | null>>;
}) {
  return (
    <>
      <p className="text-sm text-muted-foreground max-w-3xl">
        Links provider billing (account-wide) to agent session usage
        {selectedSourceId ? ` for ${agentScope}` : ""}. Matched spend is
        rule-based with confidence — raw agent and provider totals are never
        summed. See{" "}
        <code className="text-xs">docs/spend-reconciliation.md</code>.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="text-xs text-muted-foreground mr-1">Providers</span>
          <Button
            size="sm"
            variant={includedProviders == null ? "default" : "outline"}
            onClick={() => setIncludedProviders(null)}
          >
            All
          </Button>
          {PROVIDER_FILTER_OPTIONS.map((p) => {
            const active =
              includedProviders != null && includedProviders.includes(p);
            return (
              <Button
                key={p}
                size="sm"
                variant={active ? "default" : "outline"}
                onClick={() => {
                  setIncludedProviders((prev) => {
                    if (prev == null) return [p];
                    if (prev.includes(p)) {
                      const next = prev.filter((x) => x !== p);
                      return next.length ? next : null;
                    }
                    return [...prev, p];
                  });
                }}
              >
                {p}
              </Button>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="text-xs text-muted-foreground mr-1">BYOK</span>
          {BYOK_OPTIONS.map((o) => (
            <Button
              key={o.value}
              size="sm"
              variant={byokTreatment === o.value ? "default" : "outline"}
              onClick={() => setByokTreatment(o.value)}
            >
              {o.label}
            </Button>
          ))}
        </div>
      </div>

      {reconLoading ? (
        <Loading />
      ) : reconError ? (
        <Card className="border-destructive">
          <CardContent className="py-6">
            <p className="font-medium text-destructive">
              Failed to load reconciliation
            </p>
            <p className="text-sm text-muted-foreground">
              {reconError instanceof Error
                ? reconError.message
                : "Unknown error"}
            </p>
          </CardContent>
        </Card>
      ) : reconciliation ? (
        <>
          <div
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
            data-testid="attribution-summary"
          >
            <Card className="overflow-hidden border-l-4 border-l-emerald-500">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Matched spend
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold tabular-nums">
                  ${reconciliation.summary.matchedSpendUsd.toFixed(4)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Exact + likely only
                </p>
              </CardContent>
            </Card>
            <Card className="overflow-hidden border-l-4 border-l-amber-500">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Unmatched spend
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold tabular-nums">
                  ${reconciliation.summary.unmatchedProviderSpendUsd.toFixed(4)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Provider cost without agent use
                </p>
              </CardContent>
            </Card>
            <Card className="overflow-hidden border-l-4 border-l-sky-500">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Usage without cost
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold tabular-nums">
                  {reconciliation.summary.agentTokensWithoutBilling.toLocaleString()}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Agent tokens, no billing match
                </p>
              </CardContent>
            </Card>
            <Card className="overflow-hidden border-l-4 border-l-rose-500">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Duplicate risk
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold tabular-nums">
                  ${reconciliation.summary.duplicateRiskSpendUsd.toFixed(4)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  OpenRouter ∩ direct overlap
                </p>
              </CardContent>
            </Card>
            <Card className="overflow-hidden border-l-4 border-l-blue-500">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Coverage
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold tabular-nums">
                  {reconciliation.summary.coveragePct != null
                    ? `${reconciliation.summary.coveragePct}%`
                    : "—"}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Matched / provider spend
                  {reconciliation.summary.providerSpendUsd > 0 && (
                    <>
                      {" "}
                      ($
                      {reconciliation.summary.providerSpendUsd.toFixed(4)})
                    </>
                  )}
                </p>
              </CardContent>
            </Card>
          </div>

          {reconciliation.summary.hasAgentLogCost && (
            <p className="text-xs text-muted-foreground flex items-start gap-1.5">
              <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              Session-log cost in this range: $
              {(reconciliation.summary.agentLogCostUsd ?? 0).toFixed(4)}{" "}
              (provenance: session-log — not included in provider spend).
            </p>
          )}

          {reconciliation.notes.length > 0 && (
            <Card data-testid="attribution-notes">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  Reconciliation notes
                </CardTitle>
                <CardDescription>
                  Data lag, BYOK risk, and separation guarantees
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground">
                  {reconciliation.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <Card data-testid="attribution-matches">
            <CardHeader>
              <CardTitle className="text-base">
                Match evidence ({reconciliation.matches.length})
              </CardTitle>
              <CardDescription>
                Expand a row for provider contributions, agent sources, and the
                rule that fired
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {reconciliation.matches.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No provider billing or agent usage in this range.
                </p>
              ) : (
                <div className="overflow-x-auto max-w-full">
                  <table className="w-full min-w-[40rem]">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left py-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          Day
                        </th>
                        <th className="text-left py-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          Model
                        </th>
                        <th className="text-left py-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          Class
                        </th>
                        <th className="text-right py-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          Provider $
                        </th>
                        <th className="text-right py-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          Agent tokens
                        </th>
                        <th className="text-right py-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          Confidence
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {reconciliation.matches.map((m) => {
                        const open = expandedMatchKey === m.key;
                        const agentTok = m.agent
                          ? m.agent.inputTokens + m.agent.outputTokens
                          : 0;
                        return (
                          <Fragment key={m.key}>
                            <tr
                              className="border-b last:border-0 hover:bg-muted/40 cursor-pointer"
                              onClick={() =>
                                setExpandedMatchKey(open ? null : m.key)
                              }
                              data-testid={`match-row-${m.classification}`}
                            >
                              <td className="py-2 px-3 text-sm tabular-nums whitespace-nowrap">
                                <span className="inline-flex items-center gap-1">
                                  <ChevronDown
                                    className={`h-3.5 w-3.5 transition-transform ${
                                      open ? "rotate-180" : ""
                                    }`}
                                  />
                                  {m.day}
                                </span>
                              </td>
                              <td className="py-2 px-3 text-xs font-mono break-all">
                                {m.canonicalModel}
                              </td>
                              <td className="py-2 px-3">
                                <Badge
                                  variant={classificationBadgeVariant(
                                    m.classification,
                                  )}
                                >
                                  {classificationLabel(m.classification)}
                                </Badge>
                              </td>
                              <td className="py-2 px-3 text-sm text-right tabular-nums">
                                ${m.providerCostUsd.toFixed(4)}
                              </td>
                              <td className="py-2 px-3 text-sm text-right tabular-nums">
                                {agentTok.toLocaleString()}
                              </td>
                              <td className="py-2 px-3 text-sm text-right tabular-nums">
                                {(m.confidence * 100).toFixed(0)}%
                              </td>
                            </tr>
                            {open && (
                              <tr className="border-b bg-muted/20">
                                <td colSpan={6} className="px-4 py-3">
                                  <div className="grid gap-3 sm:grid-cols-2 text-sm">
                                    <div>
                                      <p className="text-xs font-semibold uppercase text-muted-foreground mb-1">
                                        Rule / evidence
                                      </p>
                                      <p>
                                        <code className="text-xs">
                                          {m.ruleHit}
                                        </code>
                                        {m.tokenRatio != null && (
                                          <span className="text-muted-foreground ml-2">
                                            token Δ ratio{" "}
                                            {(m.tokenRatio * 100).toFixed(1)}%
                                          </span>
                                        )}
                                      </p>
                                      <p className="text-xs text-muted-foreground mt-1">
                                        Key: {m.key}
                                      </p>
                                    </div>
                                    <div>
                                      <p className="text-xs font-semibold uppercase text-muted-foreground mb-1">
                                        Providers
                                      </p>
                                      {m.provider.length === 0 ? (
                                        <p className="text-muted-foreground">
                                          None
                                        </p>
                                      ) : (
                                        <ul className="space-y-1">
                                          {m.provider.map((p) => (
                                            <li key={p.provider}>
                                              <strong>{p.provider}</strong>: $
                                              {(p.costUsd ?? 0).toFixed(4)} ·{" "}
                                              {(
                                                p.inputTokens + p.outputTokens
                                              ).toLocaleString()}{" "}
                                              tok · {p.requestCount} req
                                              {p.rawModels.length > 0 && (
                                                <span className="text-xs text-muted-foreground block font-mono">
                                                  {p.rawModels.join(", ")}
                                                </span>
                                              )}
                                            </li>
                                          ))}
                                        </ul>
                                      )}
                                    </div>
                                    <div className="sm:col-span-2">
                                      <p className="text-xs font-semibold uppercase text-muted-foreground mb-1">
                                        Agent
                                      </p>
                                      {!m.agent ? (
                                        <p className="text-muted-foreground">
                                          No agent usage for this day/model
                                        </p>
                                      ) : (
                                        <p>
                                          Sources:{" "}
                                          {m.agent.sourceIds.join(", ") || "—"}{" "}
                                          ·{" "}
                                          {(
                                            m.agent.inputTokens +
                                            m.agent.outputTokens
                                          ).toLocaleString()}{" "}
                                          tokens · {m.agent.requestCount}{" "}
                                          requests
                                          {m.agent.hasLogCost && (
                                            <span className="text-muted-foreground">
                                              {" "}
                                              · session-log $
                                              {(
                                                m.agent.logCostUsd ?? 0
                                              ).toFixed(4)}
                                            </span>
                                          )}
                                          {m.agent.rawModels.length > 0 && (
                                            <span className="text-xs text-muted-foreground block font-mono mt-0.5">
                                              {m.agent.rawModels.join(", ")}
                                            </span>
                                          )}
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </>
  );
}
