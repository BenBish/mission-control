/**
 * Settings Page
 * Sources & Instances (live registry), provider budget, privacy, and About.
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
import { AlertCircle, DollarSign, Info, Server, Shield } from "lucide-react";
import {
  deleteScopedSpendBudget,
  updateProviderBudget,
  upsertScopedSpendBudget,
  useProviderBudget,
  useScopedSpendBudgets,
  useSources,
  type SpendBudget,
} from "@/lib/queries";
import { apiFetch } from "@/lib/api-client";
import { formatExactDate, formatLastActive } from "@/lib/date-utils";
import { useNow } from "@/hooks/useNow";
import {
  getEffectiveHealth,
  HEALTH_BADGE_VARIANT,
} from "@/services/sourceHealth";
import { useAuth } from "@/app/auth/AuthContext";

type SettingsTab = "sources" | "budgets" | "privacy" | "about";

function parseSettingsTab(raw: string | null): SettingsTab {
  if (
    raw === "budgets" ||
    raw === "about" ||
    raw === "sources" ||
    raw === "privacy"
  )
    return raw;
  return "sources";
}

type PrivacyPolicySnapshot = {
  redactionMode: string;
  redactSecrets: boolean;
  redactPaths: boolean;
  redactPrompts: boolean;
  redactToolPayloads: boolean;
  hideRawCwdInLists: boolean;
  retention: {
    activitiesDays: number;
    sessionsDays: number;
    inferenceDays: number;
    runtimeDays: number;
    generationsDays: number;
    jobsDays: number;
  };
  authEnabled: boolean;
  hasViewerRole: boolean;
  isProduction: boolean;
  requireAuthInProduction: boolean;
  unsafeUnauthenticated: boolean;
};

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
  const {
    data: scopedBudgets,
    isLoading: scopedLoading,
    error: scopedError,
  } = useScopedSpendBudgets();
  const { user } = useAuth();
  const isOwner = !user || user.role === "owner";
  const queryClient = useQueryClient();
  const now = useNow();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = parseSettingsTab(searchParams.get("tab"));

  const [budgetInput, setBudgetInput] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [privacy, setPrivacy] = useState<PrivacyPolicySnapshot | null>(null);
  const [privacyLoading, setPrivacyLoading] = useState(false);
  const [privacyError, setPrivacyError] = useState<string | null>(null);
  const [privacyActionMsg, setPrivacyActionMsg] = useState<string | null>(null);
  const [privacyActionErr, setPrivacyActionErr] = useState<string | null>(null);
  const [privacyBusy, setPrivacyBusy] = useState(false);

  const [scopeType, setScopeType] =
    useState<SpendBudget["scopeType"]>("provider");
  const [scopeKey, setScopeKey] = useState("");
  const [scopeAmount, setScopeAmount] = useState("");
  const [scopeWarn, setScopeWarn] = useState("80");
  const [scopeCritical, setScopeCritical] = useState("100");
  const [scopeSaving, setScopeSaving] = useState(false);
  const [scopeMessage, setScopeMessage] = useState<string | null>(null);
  const [scopeError, setScopeError] = useState<string | null>(null);

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

  useEffect(() => {
    if (activeTab !== "privacy") return;
    let cancelled = false;
    setPrivacyLoading(true);
    setPrivacyError(null);
    void (async () => {
      try {
        const res = await apiFetch("/api/privacy/policy");
        const body = await res.json();
        if (!res.ok || !body.success) {
          throw new Error(body.error || "Failed to load privacy policy");
        }
        if (!cancelled) setPrivacy(body.policy as PrivacyPolicySnapshot);
      } catch (err) {
        if (!cancelled) {
          setPrivacyError(
            err instanceof Error
              ? err.message
              : "Failed to load privacy policy",
          );
        }
      } finally {
        if (!cancelled) setPrivacyLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTab]);

  async function handleRunRetention() {
    setPrivacyBusy(true);
    setPrivacyActionMsg(null);
    setPrivacyActionErr(null);
    try {
      const res = await apiFetch("/api/privacy/retention/run", {
        method: "POST",
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body.error || "Retention failed");
      }
      setPrivacyActionMsg(
        `Retention complete: activities=${body.result?.activitiesDeleted ?? 0}, sessions=${body.result?.sessionsDeleted ?? 0}, inference=${body.result?.inferenceDeleted ?? 0}`,
      );
    } catch (err) {
      setPrivacyActionErr(
        err instanceof Error ? err.message : "Retention failed",
      );
    } finally {
      setPrivacyBusy(false);
    }
  }

  async function handlePurgeSensitive(strict: boolean) {
    setPrivacyBusy(true);
    setPrivacyActionMsg(null);
    setPrivacyActionErr(null);
    try {
      const res = await apiFetch("/api/privacy/purge-sensitive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strict }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body.error || "Purge failed");
      }
      setPrivacyActionMsg(
        `Scrubbed ${body.result?.activitiesUpdated ?? 0} activity row(s). ${body.note ?? ""}`,
      );
    } catch (err) {
      setPrivacyActionErr(err instanceof Error ? err.message : "Purge failed");
    } finally {
      setPrivacyBusy(false);
    }
  }

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

  async function handleSaveScopedBudget() {
    setScopeSaving(true);
    setScopeMessage(null);
    setScopeError(null);
    try {
      const monthlyBudgetUsd = Number(scopeAmount);
      if (!Number.isFinite(monthlyBudgetUsd) || monthlyBudgetUsd < 0) {
        setScopeError("Amount must be a non-negative number");
        return;
      }
      const key = scopeType === "account" ? "*" : scopeKey.trim();
      if (scopeType !== "account" && !key) {
        setScopeError(
          "Scope key is required (e.g. openrouter or openrouter/model)",
        );
        return;
      }
      await upsertScopedSpendBudget({
        scopeType,
        scopeKey: key,
        monthlyBudgetUsd,
        warnThresholdPct: Number(scopeWarn) || 80,
        criticalThresholdPct: Number(scopeCritical) || 100,
        enabled: true,
      });
      await queryClient.invalidateQueries({
        queryKey: ["provider-scoped-budgets"],
      });
      await queryClient.invalidateQueries({
        queryKey: ["provider-spend-insights"],
      });
      setScopeMessage(`Saved ${scopeType}/${key} budget $${monthlyBudgetUsd}`);
      setScopeKey("");
      setScopeAmount("");
    } catch (err) {
      setScopeError(
        err instanceof Error ? err.message : "Failed to save scoped budget",
      );
    } finally {
      setScopeSaving(false);
    }
  }

  async function handleDeleteScoped(id: string) {
    try {
      await deleteScopedSpendBudget(id);
      await queryClient.invalidateQueries({
        queryKey: ["provider-scoped-budgets"],
      });
      await queryClient.invalidateQueries({
        queryKey: ["provider-spend-insights"],
      });
    } catch (err) {
      setScopeError(
        err instanceof Error ? err.message : "Failed to delete budget",
      );
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Source registry, budgets, privacy controls, and application info"
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
          <TabsTrigger value="privacy">
            <Shield className="mr-2 h-4 w-4" />
            Privacy
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

          <Card>
            <CardHeader>
              <CardTitle>Scoped budgets</CardTitle>
              <CardDescription>
                Cap spend by provider, model (
                <code className="text-xs">provider/model</code>), or project.
                Provider/model scopes use actual Direct API Spend; project scope
                uses agent-attributed cost only — never mixed.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {scopedLoading ? (
                <Loading />
              ) : scopedError ? (
                <p className="text-sm text-destructive">
                  {scopedError instanceof Error
                    ? scopedError.message
                    : "Failed to load scoped budgets"}
                </p>
              ) : (
                <>
                  {(scopedBudgets ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No scoped budgets yet. Add one below.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {(scopedBudgets ?? []).map((b) => (
                        <li
                          key={b.id}
                          className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm"
                        >
                          <Badge variant="outline" className="text-xs">
                            {b.scopeType}
                          </Badge>
                          <span className="font-mono text-xs break-all">
                            {b.scopeKey}
                          </span>
                          <span className="tabular-nums">
                            ${b.monthlyBudgetUsd.toFixed(2)}/mo
                          </span>
                          <span className="text-xs text-muted-foreground">
                            warn {b.warnThresholdPct}% · critical{" "}
                            {b.criticalThresholdPct}%
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs ml-auto text-destructive"
                            onClick={() => void handleDeleteScoped(b.id)}
                          >
                            Remove
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 max-w-3xl border-t pt-4">
                    <div className="space-y-2">
                      <label
                        className="text-sm font-medium"
                        htmlFor="scope-type"
                      >
                        Scope type
                      </label>
                      <Select
                        value={scopeType}
                        onValueChange={(v) =>
                          setScopeType(v as SpendBudget["scopeType"])
                        }
                      >
                        <SelectTrigger id="scope-type">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="account">account</SelectItem>
                          <SelectItem value="provider">provider</SelectItem>
                          <SelectItem value="model">model</SelectItem>
                          <SelectItem value="project">project</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <label
                        className="text-sm font-medium"
                        htmlFor="scope-key"
                      >
                        Scope key
                      </label>
                      <Input
                        id="scope-key"
                        placeholder={
                          scopeType === "model"
                            ? "openrouter/anthropic/claude"
                            : scopeType === "project"
                              ? "mission-control"
                              : scopeType === "account"
                                ? "*"
                                : "openrouter"
                        }
                        value={scopeType === "account" ? "*" : scopeKey}
                        disabled={scopeType === "account"}
                        onChange={(e) => setScopeKey(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <label
                        className="text-sm font-medium"
                        htmlFor="scope-amount"
                      >
                        Monthly USD
                      </label>
                      <Input
                        id="scope-amount"
                        type="number"
                        min={0}
                        step="0.01"
                        value={scopeAmount}
                        onChange={(e) => setScopeAmount(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <label
                        className="text-sm font-medium"
                        htmlFor="scope-warn"
                      >
                        Warn %
                      </label>
                      <Input
                        id="scope-warn"
                        type="number"
                        min={1}
                        max={100}
                        value={scopeWarn}
                        onChange={(e) => setScopeWarn(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <label
                        className="text-sm font-medium"
                        htmlFor="scope-critical"
                      >
                        Critical %
                      </label>
                      <Input
                        id="scope-critical"
                        type="number"
                        min={1}
                        max={200}
                        value={scopeCritical}
                        onChange={(e) => setScopeCritical(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      onClick={() => void handleSaveScopedBudget()}
                      disabled={scopeSaving}
                    >
                      {scopeSaving ? "Saving…" : "Add scoped budget"}
                    </Button>
                    {scopeMessage && (
                      <p className="text-sm text-muted-foreground">
                        {scopeMessage}
                      </p>
                    )}
                    {scopeError && (
                      <p className="text-sm text-destructive">{scopeError}</p>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="privacy" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Privacy & access</CardTitle>
              <CardDescription>
                Redaction, retention, and auth posture. Policy is configured via
                environment variables (see deploy/server.env.example). Sensitive
                actions require the owner role.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {privacyLoading ? (
                <Loading />
              ) : privacyError ? (
                <div className="flex items-center gap-3 text-destructive py-2">
                  <AlertCircle className="h-5 w-5" />
                  <p className="text-sm">{privacyError}</p>
                </div>
              ) : privacy ? (
                <>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary">
                      redaction: {privacy.redactionMode}
                    </Badge>
                    <Badge
                      variant={privacy.authEnabled ? "success" : "destructive"}
                    >
                      auth: {privacy.authEnabled ? "enabled" : "disabled"}
                    </Badge>
                    {privacy.hasViewerRole && (
                      <Badge variant="outline">viewer role configured</Badge>
                    )}
                    {privacy.unsafeUnauthenticated && (
                      <Badge variant="destructive">
                        unsafe unauthenticated (production)
                      </Badge>
                    )}
                  </div>

                  <div className="grid gap-2 text-sm sm:grid-cols-2">
                    <p>
                      Secrets redaction:{" "}
                      <span className="font-medium">
                        {privacy.redactSecrets ? "on" : "off"}
                      </span>
                    </p>
                    <p>
                      Path redaction:{" "}
                      <span className="font-medium">
                        {privacy.redactPaths ? "on" : "off"}
                      </span>
                    </p>
                    <p>
                      Prompt redaction:{" "}
                      <span className="font-medium">
                        {privacy.redactPrompts ? "on (strict)" : "standard"}
                      </span>
                    </p>
                    <p>
                      Tool payload redaction:{" "}
                      <span className="font-medium">
                        {privacy.redactToolPayloads ? "on" : "off"}
                      </span>
                    </p>
                    <p>
                      Hide raw cwd in lists:{" "}
                      <span className="font-medium">
                        {privacy.hideRawCwdInLists ? "yes" : "no"}
                      </span>
                    </p>
                    <p>
                      Require auth in production:{" "}
                      <span className="font-medium">
                        {privacy.requireAuthInProduction ? "yes" : "no"}
                      </span>
                    </p>
                  </div>

                  <div>
                    <p className="text-sm font-medium mb-2">
                      Retention (days by data class)
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm text-muted-foreground">
                      <span>
                        activities: {privacy.retention.activitiesDays}d
                      </span>
                      <span>sessions: {privacy.retention.sessionsDays}d</span>
                      <span>inference: {privacy.retention.inferenceDays}d</span>
                      <span>runtime: {privacy.retention.runtimeDays}d</span>
                      <span>
                        generations: {privacy.retention.generationsDays}d
                      </span>
                      <span>jobs: {privacy.retention.jobsDays}d</span>
                    </div>
                  </div>

                  {isOwner ? (
                    <div className="flex flex-wrap gap-2 border-t pt-4">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={privacyBusy}
                        onClick={() => void handleRunRetention()}
                      >
                        Run retention now
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={privacyBusy}
                        onClick={() => void handlePurgeSensitive(false)}
                      >
                        Scrub stored details/results
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={privacyBusy}
                        onClick={() => void handlePurgeSensitive(true)}
                      >
                        Strict scrub (truncate prompts)
                      </Button>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground border-t pt-4">
                      Viewer role: purge and retention actions are owner-only.
                    </p>
                  )}

                  {privacyActionMsg && (
                    <p className="text-sm text-muted-foreground">
                      {privacyActionMsg}
                    </p>
                  )}
                  {privacyActionErr && (
                    <p className="text-sm text-destructive">
                      {privacyActionErr}
                    </p>
                  )}
                </>
              ) : null}
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
