import { Loading } from "@/components/_shared/Loading";
import { providerUsageExportPath } from "@/lib/consumption-export";
import { downloadConsumptionExport } from "@/lib/download-export";
import type { ProviderBreakdownRow } from "@/lib/queries";
import { ExportMenu } from "./ExportMenu";
import type { ProviderTotals, UpdateConsumptionParams } from "./types";

export function ProviderBreakdown({
  rangeLabel,
  providerLoading,
  providerTotals,
  providerBreakdown,
  updateParams,
  since,
}: {
  rangeLabel: string;
  providerLoading: boolean;
  providerTotals: ProviderTotals;
  providerBreakdown: ProviderBreakdownRow[] | undefined;
  updateParams: UpdateConsumptionParams;
  since?: string;
}) {
  return (
    <>
      {/* ── Provider breakdown: selected range ─────────────────── */}
      <section
        className="space-y-3 min-w-0 border-t pt-6"
        data-testid="direct-api-attribution"
        aria-labelledby="direct-api-attribution-heading"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="space-y-0.5 min-w-0">
            <h2
              id="direct-api-attribution-heading"
              className="text-sm font-semibold tracking-wide text-muted-foreground uppercase"
            >
              Provider breakdown
            </h2>
            <span className="text-xs text-muted-foreground">
              Billing rows in selected range ({rangeLabel}) — not agent matched
            </span>
          </div>
          <ExportMenu
            testId="export-provider-usage"
            label="Export daily usage"
            disabled={providerLoading}
            onExport={(format) =>
              downloadConsumptionExport(
                providerUsageExportPath({ format, since }),
              )
            }
          />
        </div>

        {providerLoading ? (
          <Loading />
        ) : providerTotals.hasCost || providerTotals.tokens > 0 ? (
          <>
            <div className="flex flex-wrap gap-4 text-sm">
              <span className="tabular-nums">
                Tokens:{" "}
                <strong>{providerTotals.tokens.toLocaleString()}</strong>
              </span>
              {providerTotals.hasCost && (
                <span className="tabular-nums">
                  Cost: <strong>${providerTotals.cost.toFixed(4)}</strong>
                </span>
              )}
            </div>
            <div className="overflow-x-auto max-w-full">
              <table className="w-full min-w-[28rem]">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left py-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Provider
                    </th>
                    <th className="text-left py-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Model
                    </th>
                    <th className="text-right py-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Input
                    </th>
                    <th className="text-right py-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Output
                    </th>
                    <th className="text-right py-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Cost
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(providerBreakdown ?? []).map((row) => (
                    <tr
                      key={`${row.provider}:${row.model}`}
                      className="border-b last:border-0 hover:bg-muted/40"
                    >
                      <td className="py-2 px-3 text-sm font-medium">
                        {row.provider}
                      </td>
                      <td className="py-2 px-3 text-xs font-mono break-all">
                        {row.model}
                      </td>
                      <td className="py-2 px-3 text-sm text-right tabular-nums">
                        {row.input_tokens.toLocaleString()}
                      </td>
                      <td className="py-2 px-3 text-sm text-right tabular-nums">
                        {row.output_tokens.toLocaleString()}
                      </td>
                      <td className="py-2 px-3 text-sm text-right tabular-nums">
                        {row.cost_usd != null
                          ? `$${row.cost_usd.toFixed(4)}`
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="py-6 text-center space-y-1">
            <p className="text-sm text-muted-foreground">
              No Direct API Spend for this range.
            </p>
            <p className="text-sm text-muted-foreground">
              Configure provider keys under Capacity &amp; data health, then
              Sync now. Agent session usage is under{" "}
              <button
                type="button"
                className="underline hover:text-foreground"
                onClick={() => updateParams({ view: "agent" })}
              >
                Agent Usage
              </button>
              .
            </p>
          </div>
        )}
      </section>
    </>
  );
}
