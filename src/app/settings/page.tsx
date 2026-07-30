/**
 * Settings Page
 * Sources & Instances (live registry), provider budget, and About.
 */

import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/_shared/PageHeader";
import { Loading } from "@/components/_shared/Loading";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertCircle, DollarSign, Info, Server } from "lucide-react";
import {
  updateProviderBudget,
  useProviderBudget,
  useSources,
} from "@/lib/queries";
import { formatExactDate, formatLastActive } from "@/lib/date-utils";
import { useNow } from "@/hooks/useNow";
import {
  getEffectiveHealth,
  HEALTH_BADGE_VARIANT,
} from "@/services/sourceHealth";

type SettingsTab = "sources" | "budgets" | "about";

function parseSettingsTab(raw: string | null): SettingsTab {
  if (raw === "budgets" || raw === "about" || raw === "sources") return raw;
  return "sources";
}

const COMMON_TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Paris",
  "Asia/Tokyo",
  "Australia/Sydney",
];

export default function SettingsPage() {
  const { data: sources, isLoading, error } = useSources();
  const {
    data: budget,
    isLoading: budgetLoading,
    error: budgetError,
  } = useProviderBudget();
  const queryClient = useQueryClient();
  const now = useNow();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = parseSettingsTab(searchParams.get("tab"));

  const [budgetInput, setBudgetInput] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  function setActiveTab(tab: SettingsTab) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (tab === "sources") next.delete("tab");
        else next.set("tab", tab);
        return next;
      },
      { replace: true },
    );
  }

  useEffect(() => {
    if (!budget) return;
    setBudgetInput(
      budget.monthlyBudgetUsd == null ? "" : String(budget.monthlyBudgetUsd),
    );
    setTimezone(budget.timezone || "UTC");
  }, [budget]);

  async function handleSaveBudget() {
    setSaving(true);
    setSaveMessage(null);
    setSaveError(null);
    try {
      const trimmed = budgetInput.trim();
      const monthlyBudgetUsd = trimmed === "" ? null : Number(trimmed);
      if (
        monthlyBudgetUsd !== null &&
        (!Number.isFinite(monthlyBudgetUsd) || monthlyBudgetUsd < 0)
      ) {
        setSaveError("Budget must be a non-negative number, or empty to clear");
        return;
      }
      await updateProviderBudget({ monthlyBudgetUsd, timezone });
      await queryClient.invalidateQueries({ queryKey: ["provider-budget"] });
      await queryClient.invalidateQueries({
        queryKey: ["provider-spend-insights"],
      });
      setSaveMessage(
        monthlyBudgetUsd == null
          ? "Budget cleared"
          : `Budget saved: $${monthlyBudgetUsd.toFixed(2)} / month (${timezone})`,
      );
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Failed to save budget",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Source registry, provider budget, and application info"
      />

      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(parseSettingsTab(v))}
      >
        <TabsList>
          <TabsTrigger value="sources">
            <Server className="mr-2 h-4 w-4" />
            Sources & Instances
          </TabsTrigger>
          <TabsTrigger value="budgets">
            <DollarSign className="mr-2 h-4 w-4" />
            Budgets
          </TabsTrigger>
          <TabsTrigger value="about">
            <Info className="mr-2 h-4 w-4" />
            About
          </TabsTrigger>
        </TabsList>

        <TabsContent value="sources" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Sources</CardTitle>
              <CardDescription>
                Every source and its collector instances, seeded once at server
                startup. Effective status uses heartbeat age so stale collectors
                cannot stay green indefinitely.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Loading />
              ) : error ? (
                <div className="flex items-center gap-3 text-destructive py-4">
                  <AlertCircle className="h-5 w-5" />
                  <p className="text-sm">
                    {error instanceof Error
                      ? error.message
                      : "Failed to load sources"}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="px-4 py-2 text-left font-medium text-muted-foreground">
                          Source
                        </th>
                        <th className="px-4 py-2 text-left font-medium text-muted-foreground">
                          Instance
                        </th>
                        <th className="px-4 py-2 text-left font-medium text-muted-foreground">
                          Machine
                        </th>
                        <th className="px-4 py-2 text-left font-medium text-muted-foreground">
                          Collector
                        </th>
                        <th className="px-4 py-2 text-left font-medium text-muted-foreground">
                          Status
                        </th>
                        <th className="px-4 py-2 text-right font-medium text-muted-foreground">
                          Last Seen
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {(sources ?? []).flatMap((source) =>
                        source.instances.map((instance) => {
                          const health = getEffectiveHealth(instance, now);
                          return (
                            <tr
                              key={instance.id}
                              className="border-b last:border-0"
                            >
                              <td className="px-4 py-2 font-medium">
                                {source.name}
                              </td>
                              <td className="px-4 py-2 font-mono text-xs">
                                {instance.id}
                              </td>
                              <td className="px-4 py-2">{instance.machine}</td>
                              <td className="px-4 py-2">
                                <Badge variant="outline" className="text-xs">
                                  {instance.collectorKind}
                                </Badge>
                              </td>
                              <td className="px-4 py-2">
                                <Badge
                                  variant={HEALTH_BADGE_VARIANT[health.status]}
                                >
                                  {health.status}
                                </Badge>
                                {instance.lastError && (
                                  <p className="mt-1 text-xs text-destructive">
                                    {instance.lastError}
                                  </p>
                                )}
                              </td>
                              <td className="px-4 py-2 text-right text-muted-foreground">
                                <div className="flex flex-col items-end gap-0.5">
                                  <span>
                                    {formatLastActive(instance.lastSeenAt)}
                                  </span>
                                  {instance.lastSeenAt && (
                                    <span
                                      className="text-xs opacity-70"
                                      title={formatExactDate(
                                        instance.lastSeenAt,
                                      )}
                                    >
                                      {formatExactDate(instance.lastSeenAt)}
                                    </span>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        }),
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="budgets" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Provider spend budget</CardTitle>
              <CardDescription>
                Monthly budget for account-wide Direct API Spend (provider
                billing APIs only). Does not include Agent Usage from session
                logs and is never double-counted with those totals.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {budgetLoading ? (
                <Loading />
              ) : budgetError ? (
                <div className="flex items-center gap-3 text-destructive py-2">
                  <AlertCircle className="h-5 w-5" />
                  <p className="text-sm">
                    {budgetError instanceof Error
                      ? budgetError.message
                      : "Failed to load budget"}
                  </p>
                </div>
              ) : (
                <>
                  <div className="grid gap-4 sm:grid-cols-2 max-w-xl">
                    <div className="space-y-2">
                      <label
                        htmlFor="monthly-budget"
                        className="text-sm font-medium"
                      >
                        Monthly budget (USD)
                      </label>
                      <Input
                        id="monthly-budget"
                        type="number"
                        min={0}
                        step="0.01"
                        placeholder="e.g. 500"
                        value={budgetInput}
                        onChange={(e) => setBudgetInput(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        Leave empty to disable budget tracking.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <label
                        htmlFor="budget-timezone"
                        className="text-sm font-medium"
                      >
                        Month timezone
                      </label>
                      <Select value={timezone} onValueChange={setTimezone}>
                        <SelectTrigger id="budget-timezone" className="w-full">
                          <SelectValue placeholder="Select timezone" />
                        </SelectTrigger>
                        <SelectContent>
                          {[...new Set([timezone, ...COMMON_TIMEZONES])].map(
                            (tz) => (
                              <SelectItem key={tz} value={tz}>
                                {tz}
                              </SelectItem>
                            ),
                          )}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Calendar month boundaries for MTD and forecast use this
                        IANA timezone (default UTC).
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      onClick={() => void handleSaveBudget()}
                      disabled={saving}
                    >
                      {saving ? "Saving…" : "Save budget"}
                    </Button>
                    {saveMessage && (
                      <p className="text-sm text-muted-foreground">
                        {saveMessage}
                      </p>
                    )}
                    {saveError && (
                      <p className="text-sm text-destructive">{saveError}</p>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="about">
          <Card>
            <CardHeader>
              <CardTitle>About Mission Control</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="font-medium">Version:</span>
                  <span className="font-mono text-sm text-muted-foreground">
                    0.0.0
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  A unified dashboard for AI usage across Claude Code, Codex
                  CLI, and local inference infrastructure (Hermes, Lemonade,
                  ComfyUI).
                </p>
              </div>
              <div>
                <a
                  href="https://github.com/BenBish/mission-control"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary underline-offset-4 hover:underline"
                >
                  github.com/BenBish/mission-control
                </a>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
