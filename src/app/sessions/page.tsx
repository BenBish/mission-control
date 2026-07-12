import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/_shared/PageHeader";
import { Loading } from "@/components/_shared/Loading";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight, History } from "lucide-react";
import { useSourceFilter } from "@/app/source-context";
import { useSessionList } from "@/lib/queries";
import { formatLastActive } from "@/lib/date-utils";

const PAGE_SIZE = 50;

function formatDuration(startTime: string, endTime?: string): string {
  if (!endTime) return "";
  const ms = new Date(endTime).getTime() - new Date(startTime).getTime();
  if (ms < 0) return "0s";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

function successRateColor(rate: number): string {
  if (rate >= 90) return "text-emerald-700 dark:text-emerald-400";
  if (rate >= 70) return "text-amber-700 dark:text-amber-400";
  return "text-red-700 dark:text-red-400";
}

export default function SessionsPage() {
  const [page, setPage] = useState(1);
  const navigate = useNavigate();
  const { selectedSourceId } = useSourceFilter();
  const offset = (page - 1) * PAGE_SIZE;
  const {
    data: sessions,
    isLoading,
    error,
  } = useSessionList({ sourceId: selectedSourceId, limit: PAGE_SIZE, offset });

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Sessions" description="View all agentic sessions" />
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-3 py-6">
            <div>
              <p className="font-medium text-destructive">
                Error loading sessions
              </p>
              <p className="text-sm text-muted-foreground">
                {error instanceof Error ? error.message : "Unknown error"}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const count = sessions?.length ?? 0;
  const showingFrom = count > 0 ? offset + 1 : 0;
  const showingTo = offset + count;

  return (
    <div className="space-y-6">
      <PageHeader title="Sessions" description="View all agentic sessions" />

      <Card className="shadow-sm">
        <CardHeader className="pb-4 border-b">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-lg">
              <div className="p-1.5 rounded-md bg-primary/10">
                <History className="h-4 w-4 text-primary" />
              </div>
              Sessions
            </CardTitle>
            {count > 0 && (
              <Badge variant="outline" className="font-normal">
                {count} sessions
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="pt-0 px-0">
          {isLoading ? (
            <div className="py-12">
              <Loading />
            </div>
          ) : count === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-12">
              No sessions recorded yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Started
                    </th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Source
                    </th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Duration
                    </th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      cwd
                    </th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Turns
                    </th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Success Rate
                    </th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Tokens
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(sessions ?? []).map((session, index) => {
                    const successRate =
                      session.stats.toolCallCount > 0
                        ? ((session.stats.toolCallCount -
                            session.stats.failureCount) /
                            session.stats.toolCallCount) *
                          100
                        : null;
                    const totalTokens =
                      session.stats.inputTokens + session.stats.outputTokens;

                    return (
                      <tr
                        key={session.sessionId}
                        className={`border-b last:border-0 hover:bg-muted/60 cursor-pointer transition-colors ${
                          index % 2 === 1 ? "bg-muted/20" : ""
                        }`}
                        onClick={() =>
                          navigate(`/sessions/${session.sessionId}`)
                        }
                      >
                        <td className="py-3 px-4 text-sm whitespace-nowrap">
                          <span
                            className="tabular-nums text-muted-foreground"
                            title={new Date(session.startTime).toLocaleString()}
                          >
                            {formatLastActive(session.startTime)}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-sm">
                          <Badge variant="secondary" className="text-xs">
                            {session.sourceId}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-sm whitespace-nowrap">
                          {session.endTime ? (
                            <span className="tabular-nums">
                              {formatDuration(
                                session.startTime,
                                session.endTime,
                              )}
                            </span>
                          ) : (
                            <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800">
                              Active
                            </Badge>
                          )}
                        </td>
                        <td className="py-3 px-4 text-sm text-muted-foreground truncate max-w-[200px]">
                          {session.cwd ?? "—"}
                        </td>
                        <td className="py-3 px-4 text-sm text-right tabular-nums">
                          {session.stats.turnCount}
                        </td>
                        <td className="py-3 px-4 text-sm text-right tabular-nums">
                          {successRate !== null ? (
                            <span
                              className={`font-medium ${successRateColor(successRate)}`}
                            >
                              {successRate.toFixed(0)}%
                            </span>
                          ) : (
                            <span className="text-muted-foreground/50">—</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-sm text-right tabular-nums">
                          {totalTokens.toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!isLoading && count > 0 && (
            <div className="flex items-center justify-between border-t px-4 py-3">
              <span className="text-sm text-muted-foreground">
                Showing {showingFrom}–{showingTo}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={count < PAGE_SIZE}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
