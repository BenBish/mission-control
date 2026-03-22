import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSessions, type SessionRow } from "./hooks/useSessions";
import { PageHeader } from "@/components/_shared/PageHeader";
import { Loading } from "@/components/_shared/Loading";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, ChevronLeft, ChevronRight, History } from "lucide-react";
import { useProfile } from "@/app/profile-context";
import { formatLastActive } from "@/lib/date-utils";
import { parseActors } from "@/lib/parse-actors";

const PAGE_SIZE = 50;

function formatDuration(startTime: string, endTime: string | null): string {
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

function formatCost(cost: number): string {
  if (cost === 0) return "$0.00";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

function getSuccessRateColor(rate: number): string {
  if (rate >= 90) return "text-emerald-700 dark:text-emerald-400";
  if (rate >= 70) return "text-amber-700 dark:text-amber-400";
  return "text-red-700 dark:text-red-400";
}

export default function SessionsPage() {
  const [page, setPage] = useState(1);
  const navigate = useNavigate();
  const { profileId, isSwitching } = useProfile();
  const offset = (page - 1) * PAGE_SIZE;
  const { sessions, total, isLoading, error } = useSessions(
    profileId,
    PAGE_SIZE,
    offset,
  );

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Sessions" description="View all agent sessions" />
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-3 py-6">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <div>
              <p className="font-medium text-destructive">
                Error loading sessions
              </p>
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const showingFrom = sessions.length > 0 ? offset + 1 : 0;
  const showingTo = offset + sessions.length;

  return (
    <div className="space-y-6">
      <PageHeader title="Sessions" description="View all agent sessions" />

      <Card className="shadow-sm">
        <CardHeader className="pb-4 border-b">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-lg">
              <div className="p-1.5 rounded-md bg-primary/10">
                <History className="h-4 w-4 text-primary" />
              </div>
              Sessions
            </CardTitle>
            {total > 0 && (
              <Badge variant="outline" className="font-normal">
                {total > PAGE_SIZE
                  ? `Showing ${showingFrom}–${showingTo} of ${total}`
                  : `${total} sessions`}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="pt-0 px-0">
          {isLoading || isSwitching ? (
            <div className="py-12">
              <Loading />
            </div>
          ) : sessions.length === 0 ? (
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
                      Duration
                    </th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Actors
                    </th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Actions
                    </th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Success Rate
                    </th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Cost
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((session: SessionRow, index: number) => {
                    const actors = parseActors(session.actors_json);
                    const successRate =
                      session.total_actions > 0
                        ? (session.success_count / session.total_actions) * 100
                        : 0;

                    return (
                      <tr
                        key={session.id}
                        className={`border-b last:border-0 hover:bg-muted/60 cursor-pointer transition-colors ${
                          index % 2 === 1 ? "bg-muted/20" : ""
                        }`}
                        onClick={() => navigate(`/sessions/${session.id}`)}
                      >
                        <td className="py-3 px-4 text-sm whitespace-nowrap">
                          <span
                            className="tabular-nums text-muted-foreground"
                            title={new Date(
                              session.start_time,
                            ).toLocaleString()}
                          >
                            {formatLastActive(session.start_time)}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-sm whitespace-nowrap">
                          {session.end_time ? (
                            <span className="tabular-nums">
                              {formatDuration(
                                session.start_time,
                                session.end_time,
                              )}
                            </span>
                          ) : (
                            <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800">
                              Active
                            </Badge>
                          )}
                        </td>
                        <td className="py-3 px-4 text-sm">
                          <div className="flex flex-wrap gap-1">
                            {actors.slice(0, 3).map((actor) => (
                              <Badge
                                key={actor.id}
                                variant="secondary"
                                className="text-xs"
                              >
                                {actor.emoji && (
                                  <span className="mr-0.5">{actor.emoji}</span>
                                )}
                                {actor.displayName || actor.id}
                              </Badge>
                            ))}
                            {actors.length > 3 && (
                              <Badge variant="outline" className="text-xs">
                                +{actors.length - 3} more
                              </Badge>
                            )}
                            {actors.length === 0 && (
                              <span className="text-muted-foreground/50">
                                —
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-sm text-right tabular-nums">
                          {session.total_actions}
                        </td>
                        <td className="py-3 px-4 text-sm text-right tabular-nums">
                          {session.total_actions > 0 ? (
                            <span
                              className={`font-medium ${getSuccessRateColor(successRate)}`}
                            >
                              {successRate.toFixed(0)}%
                            </span>
                          ) : (
                            <span className="text-muted-foreground/50">—</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-sm text-right font-medium tabular-nums">
                          {formatCost(session.total_cost_usd)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {!isLoading && sessions.length > 0 && (
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
                  disabled={sessions.length < PAGE_SIZE}
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
