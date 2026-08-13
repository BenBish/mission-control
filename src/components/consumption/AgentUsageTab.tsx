import { Fragment, type Dispatch, type SetStateAction } from "react";
import { Link } from "react-router-dom";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DollarSign, Zap, Cpu, AlertTriangle } from "lucide-react";
import type {
  AgentUsageDimension,
  AgentUsageDriver,
  AgentUsageSessionRow,
  AgentUsageSummary,
} from "@/lib/queries";
import { AGENT_DIMENSIONS, UNITS } from "./constants";
import { formatCompute } from "./helpers";
import type { AgentUsageTotals, Unit, UpdateConsumptionParams } from "./types";

export function AgentUsageTab({
  unit,
  totals,
  agentUsage,
  coverage,
  selectedSourceId,
  agentScope,
  updateParams,
  includeNonMaterial,
  setIncludeNonMaterial,
  agentDimension,
  setAgentDimension,
  expandedDriverKey,
  setExpandedDriverKey,
  drivers,
  drillLoading,
  drillSessions,
}: {
  unit: Unit;
  totals: AgentUsageTotals;
  agentUsage: AgentUsageSummary | undefined;
  coverage: AgentUsageSummary["coverage"] | undefined;
  selectedSourceId: string | undefined;
  agentScope: string;
  updateParams: UpdateConsumptionParams;
  includeNonMaterial: boolean;
  setIncludeNonMaterial: Dispatch<SetStateAction<boolean>>;
  agentDimension: AgentUsageDimension;
  setAgentDimension: Dispatch<SetStateAction<AgentUsageDimension>>;
  expandedDriverKey: string | null;
  setExpandedDriverKey: Dispatch<SetStateAction<string | null>>;
  drivers: AgentUsageDriver[];
  drillLoading: boolean;
  drillSessions: { sessions: AgentUsageSessionRow[] } | undefined;
}) {
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground max-w-2xl">
          Session-derived usage from agent sources (Claude Code, Codex, Grok,
          Hermes, etc.) for {agentScope}. Honors the global source filter. Not
          the same as account-level provider billing.
        </p>
        <div className="flex gap-2">
          {UNITS.map((u) => (
            <Button
              key={u.value}
              variant={unit === u.value ? "default" : "outline"}
              size="sm"
              onClick={() => updateParams({ unit: u.value })}
            >
              {u.label}
            </Button>
          ))}
        </div>
      </div>

      {unit === "usd" && !totals.hasCost ? (
        <Card>
          <CardContent className="py-12 text-center">
            <div className="flex flex-col items-center gap-2 max-w-md mx-auto">
              <DollarSign className="h-12 w-12 text-muted-foreground/30" />
              <p className="text-muted-foreground">
                No billable agent usage in this range
                {selectedSourceId ? ` for ${agentScope}` : ""}. Sources here are
                subscription or local, or no{" "}
                <code className="text-xs">cost_usd</code> was recorded in
                session logs.
              </p>
              <p className="text-xs text-muted-foreground">
                Provider account billing is under the{" "}
                <button
                  type="button"
                  className="underline hover:text-foreground"
                  onClick={() => updateParams({ view: "direct-api" })}
                >
                  Direct API Spend
                </button>{" "}
                view — it is a separate dataset.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {unit === "tokens" && (
              <Card className="overflow-hidden border-l-4 border-l-blue-500">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Total Tokens
                  </CardTitle>
                  <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                    <Zap className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold tracking-tight tabular-nums">
                    {totals.tokens.toLocaleString()}
                  </div>
                  {agentUsage?.totals && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {agentUsage.totals.sessionCount.toLocaleString()} sessions
                      · {agentUsage.totals.requestCount.toLocaleString()}{" "}
                      requests
                    </p>
                  )}
                </CardContent>
              </Card>
            )}
            {unit === "compute" && (
              <Card className="overflow-hidden border-l-4 border-l-purple-500">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Compute Time
                  </CardTitle>
                  <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30">
                    <Cpu className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold tracking-tight tabular-nums">
                    {formatCompute(totals.compute)}
                  </div>
                </CardContent>
              </Card>
            )}
            {unit === "usd" && (
              <Card className="overflow-hidden border-l-4 border-l-emerald-500">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Cost
                  </CardTitle>
                  <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
                    <DollarSign className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold tracking-tight tabular-nums">
                    {totals.hasCost ? `$${totals.cost.toFixed(4)}` : "—"}
                  </div>
                </CardContent>
              </Card>
            )}
            {unit === "tokens" && coverage && (
              <>
                <Card className="overflow-hidden border-l-4 border-l-amber-500">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Unattributed
                    </CardTitle>
                    <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
                      <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold tracking-tight tabular-nums">
                      {coverage.unattributedPct}%
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {coverage.unattributedTokens.toLocaleString()} tokens
                      unknown/synthetic
                    </p>
                  </CardContent>
                </Card>
                <Card className="overflow-hidden border-l-4 border-l-slate-500">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Cache read
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold tracking-tight tabular-nums">
                      {(
                        agentUsage?.totals.cacheReadTokens ?? 0
                      ).toLocaleString()}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      write{" "}
                      {(
                        agentUsage?.totals.cacheWriteTokens ?? 0
                      ).toLocaleString()}
                    </p>
                  </CardContent>
                </Card>
              </>
            )}
          </div>

          {coverage && coverage.totalTokens > 0 && (
            <Card className="border-dashed">
              <CardContent className="py-3 text-sm text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
                <span>
                  Material ranked:{" "}
                  <strong className="text-foreground">
                    {coverage.materialTokens.toLocaleString()}
                  </strong>{" "}
                  tokens
                </span>
                <span>
                  Unknown model: {coverage.unknownModelTokens.toLocaleString()}
                </span>
                <span>
                  Synthetic: {coverage.syntheticTokens.toLocaleString()}
                </span>
                <span>
                  Zero-token rows excluded: {coverage.zeroTokenFactCount}
                </span>
                <span>
                  Missing project:{" "}
                  {coverage.missingProjectTokens.toLocaleString()} tokens
                </span>
              </CardContent>
            </Card>
          )}

          {drivers.length > 0 || coverage ? (
            <Card className="shadow-sm">
              <CardHeader className="pb-4 border-b space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-lg">Ranked drivers</CardTitle>
                    <CardDescription>
                      Canonical model identities with raw aliases for
                      diagnostics
                      {selectedSourceId ? ` · filtered to ${agentScope}` : ""}.
                      Zero-token and synthetic rows are excluded by default.
                    </CardDescription>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      className="rounded border-muted-foreground"
                      checked={includeNonMaterial}
                      onChange={(e) => {
                        setIncludeNonMaterial(e.target.checked);
                        setExpandedDriverKey(null);
                      }}
                    />
                    Show zero / synthetic
                  </label>
                </div>
                <div className="flex flex-wrap gap-2">
                  {AGENT_DIMENSIONS.map((d) => (
                    <Button
                      key={d.value}
                      variant={
                        agentDimension === d.value ? "default" : "outline"
                      }
                      size="sm"
                      onClick={() => {
                        setAgentDimension(d.value);
                        setExpandedDriverKey(null);
                      }}
                    >
                      {d.label}
                    </Button>
                  ))}
                </div>
              </CardHeader>
              <CardContent className="pt-4 px-0">
                {drivers.length === 0 ? (
                  <p className="px-4 pb-4 text-sm text-muted-foreground">
                    No material drivers for this grouping
                    {includeNonMaterial ? "" : " (try Show zero / synthetic)"}.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                            Source
                          </th>
                          <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                            {agentDimension === "model"
                              ? "Model"
                              : agentDimension === "project"
                                ? "Project"
                                : agentDimension === "actor"
                                  ? "Actor"
                                  : agentDimension === "session"
                                    ? "Session"
                                    : "Driver"}
                          </th>
                          {unit === "tokens" && (
                            <>
                              <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                Input
                              </th>
                              <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                Output
                              </th>
                              <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                Cache
                              </th>
                            </>
                          )}
                          {unit === "usd" && (
                            <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                              Cost
                            </th>
                          )}
                          {unit === "compute" && (
                            <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                              Requests
                            </th>
                          )}
                          <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                            Sessions
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {drivers.map((row) => {
                          const open = expandedDriverKey === row.key;
                          const label =
                            agentDimension === "model"
                              ? row.canonicalModel
                              : agentDimension === "project"
                                ? (row.project ?? "unassigned")
                                : agentDimension === "actor"
                                  ? (row.actorId ?? "—")
                                  : agentDimension === "session"
                                    ? (row.sessionTitle ?? row.sessionId ?? "—")
                                    : row.sourceId;
                          return (
                            <Fragment key={row.key}>
                              <tr
                                className="border-b last:border-0 hover:bg-muted/40 cursor-pointer"
                                onClick={() =>
                                  setExpandedDriverKey(open ? null : row.key)
                                }
                              >
                                <td className="py-3 px-4 text-sm">
                                  <span className="font-medium">
                                    {row.sourceId}
                                  </span>
                                </td>
                                <td className="py-3 px-4 text-sm">
                                  <div className="font-mono text-xs">
                                    {label}
                                  </div>
                                  {agentDimension === "model" &&
                                    row.rawModels.length > 0 && (
                                      <div className="text-[11px] text-muted-foreground mt-0.5">
                                        raw: {row.rawModels.join(", ")}
                                      </div>
                                    )}
                                  {row.project &&
                                    agentDimension !== "project" && (
                                      <div className="text-[11px] text-muted-foreground">
                                        {row.project}
                                      </div>
                                    )}
                                </td>
                                {unit === "tokens" && (
                                  <>
                                    <td className="py-3 px-4 text-sm text-right tabular-nums">
                                      {row.inputTokens.toLocaleString()}
                                    </td>
                                    <td className="py-3 px-4 text-sm text-right tabular-nums">
                                      {row.outputTokens.toLocaleString()}
                                    </td>
                                    <td className="py-3 px-4 text-sm text-right tabular-nums text-muted-foreground">
                                      {(
                                        row.cacheReadTokens +
                                        row.cacheWriteTokens
                                      ).toLocaleString()}
                                    </td>
                                  </>
                                )}
                                {unit === "usd" && (
                                  <td className="py-3 px-4 text-sm text-right tabular-nums">
                                    {row.hasCost
                                      ? `$${(row.costUsd ?? 0).toFixed(4)}`
                                      : "—"}
                                  </td>
                                )}
                                {unit === "compute" && (
                                  <td className="py-3 px-4 text-sm text-right tabular-nums">
                                    {row.requestCount.toLocaleString()}
                                  </td>
                                )}
                                <td className="py-3 px-4 text-sm text-right tabular-nums">
                                  {row.sessionCount.toLocaleString()}
                                </td>
                              </tr>
                              {open && (
                                <tr className="bg-muted/30">
                                  <td
                                    colSpan={unit === "tokens" ? 6 : 4}
                                    className="px-4 py-3"
                                  >
                                    <p className="text-xs font-medium mb-2">
                                      Contributing sessions
                                    </p>
                                    {drillLoading ? (
                                      <p className="text-xs text-muted-foreground">
                                        Loading…
                                      </p>
                                    ) : (
                                      <div className="overflow-x-auto">
                                        <table className="w-full text-xs">
                                          <thead>
                                            <tr className="text-muted-foreground">
                                              <th className="text-left py-1 pr-2">
                                                Session
                                              </th>
                                              <th className="text-left py-1 pr-2">
                                                Project
                                              </th>
                                              <th className="text-right py-1 pr-2">
                                                Tokens
                                              </th>
                                              <th className="text-right py-1">
                                                Requests
                                              </th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {(
                                              drillSessions?.sessions ?? []
                                            ).map((s) => (
                                              <tr key={s.sessionId}>
                                                <td className="py-1 pr-2">
                                                  {s.sessionId.startsWith(
                                                    "inference:",
                                                  ) ? (
                                                    <span className="text-muted-foreground">
                                                      inference bucket
                                                    </span>
                                                  ) : (
                                                    <Link
                                                      to={`/sessions/${encodeURIComponent(s.sessionId)}`}
                                                      className="underline hover:text-foreground"
                                                      onClick={(e) =>
                                                        e.stopPropagation()
                                                      }
                                                    >
                                                      {s.title ??
                                                        s.externalId ??
                                                        s.sessionId}
                                                    </Link>
                                                  )}
                                                </td>
                                                <td className="py-1 pr-2 text-muted-foreground">
                                                  {s.project ?? "—"}
                                                </td>
                                                <td className="py-1 pr-2 text-right tabular-nums">
                                                  {(
                                                    s.inputTokens +
                                                    s.outputTokens
                                                  ).toLocaleString()}
                                                </td>
                                                <td className="py-1 text-right tabular-nums">
                                                  {s.requestCount.toLocaleString()}
                                                </td>
                                              </tr>
                                            ))}
                                            {(drillSessions?.sessions?.length ??
                                              0) === 0 && (
                                              <tr>
                                                <td
                                                  colSpan={4}
                                                  className="py-2 text-muted-foreground"
                                                >
                                                  No sessions for this driver.
                                                </td>
                                              </tr>
                                            )}
                                          </tbody>
                                        </table>
                                      </div>
                                    )}
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
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground">
                  No Agent Usage data for this range
                  {selectedSourceId ? ` and ${agentScope}` : ""} yet.
                </p>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </>
  );
}
