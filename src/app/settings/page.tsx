/**
 * Settings Page
 * Tabbed settings page with Data Retention, Profiles, System, and About tabs.
 */

import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api-client";
import { PageHeader } from "@/components/_shared/PageHeader";
import { Loading } from "@/components/_shared/Loading";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertCircle,
  Database,
  HardDrive,
  Info,
  RotateCcw,
  Save,
  Server,
  Settings2,
  Trash2,
  Users,
} from "lucide-react";

interface SettingsData {
  config: {
    retentionHotDays: number;
    retentionWarmDays: number;
    maxOutputSize: number;
    apiPort: number;
    dbPath: string;
    nodeVersion: string;
  };
  dbStats: {
    fileSizeBytes: number;
    totalActivities: number;
    hotActivities: number;
    warmActivities: number;
    coldActivities: number;
    totalSessions: number;
    totalGenerations: number;
  };
  profiles: Array<{
    id: string;
    name: string;
    basePath: string;
    activityCount: number;
    lastActivity: string | null;
  }>;
  scanState: {
    lastScanTime: string | null;
    filesTracked: number;
    generationsScanned: number;
  };
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Never";
  return new Date(dateStr).toLocaleString();
}

function Toast({
  message,
  type,
}: {
  message: string;
  type: "success" | "error";
}) {
  return (
    <div className="fixed bottom-4 right-4 z-50 animate-in slide-in-from-bottom-4 fade-in duration-300">
      <div
        className={`rounded-lg border px-4 py-3 shadow-lg ${
          type === "error"
            ? "border-destructive bg-destructive/10 text-destructive"
            : "bg-card text-foreground"
        }`}
      >
        <p className="text-sm">{message}</p>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const [data, setData] = useState<SettingsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  // Retention form state
  const [hotDays, setHotDays] = useState("");
  const [warmDays, setWarmDays] = useState("");
  const [maxOutputSize, setMaxOutputSize] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isCleaningUp, setIsCleaningUp] = useState(false);
  const [isResettingScan, setIsResettingScan] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const showToast = useCallback(
    (message: string, type: "success" | "error") => {
      setToast({ message, type });
      setTimeout(() => setToast(null), 3000);
    },
    [],
  );

  const fetchSettings = useCallback(async () => {
    try {
      const res = await apiFetch("/api/settings");
      if (!res.ok) throw new Error("Failed to fetch settings");
      const json = await res.json();
      setData(json);
      setHotDays(String(json.config.retentionHotDays));
      setWarmDays(String(json.config.retentionWarmDays));
      setMaxOutputSize(String(json.config.maxOutputSize));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleSaveRetention = async () => {
    setIsSaving(true);
    try {
      const res = await apiFetch("/api/settings/retention", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hotDays: parseInt(hotDays, 10),
          warmDays: parseInt(warmDays, 10),
          maxOutputSize: parseInt(maxOutputSize, 10),
        }),
      });
      if (!res.ok) throw new Error("Failed to save settings");
      showToast("Retention settings saved", "success");
      await fetchSettings();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to save", "error");
    } finally {
      setIsSaving(false);
    }
  };

  const handleCleanup = async () => {
    setIsCleaningUp(true);
    try {
      const res = await apiFetch("/api/settings/cleanup", { method: "POST" });
      if (!res.ok) throw new Error("Cleanup failed");
      const json = await res.json();
      showToast(json.message || "Cleanup complete", "success");
      await fetchSettings();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Cleanup failed", "error");
    } finally {
      setIsCleaningUp(false);
    }
  };

  const handleResetScan = async () => {
    setIsResettingScan(true);
    setShowResetConfirm(false);
    try {
      const res = await apiFetch("/api/settings/reset-scan", {
        method: "POST",
      });
      if (!res.ok) throw new Error("Reset failed");
      showToast("Scan state cleared", "success");
      await fetchSettings();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Reset failed", "error");
    } finally {
      setIsResettingScan(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Settings"
          description="System configuration and database management"
        />
        <Loading />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Settings"
          description="System configuration and database management"
        />
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-3 py-6">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <div>
              <p className="font-medium text-destructive">
                Error loading settings
              </p>
              <p className="text-sm text-muted-foreground">
                {error || "No data"}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="System configuration and database management"
      />

      <Tabs defaultValue="retention">
        <TabsList>
          <TabsTrigger value="retention">
            <Database className="mr-2 h-4 w-4" />
            Data Retention
          </TabsTrigger>
          <TabsTrigger value="profiles">
            <Users className="mr-2 h-4 w-4" />
            Profiles
          </TabsTrigger>
          <TabsTrigger value="system">
            <Server className="mr-2 h-4 w-4" />
            System
          </TabsTrigger>
          <TabsTrigger value="about">
            <Info className="mr-2 h-4 w-4" />
            About
          </TabsTrigger>
        </TabsList>

        {/* Data Retention Tab */}
        <TabsContent value="retention" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings2 className="h-5 w-5" />
                Retention Configuration
              </CardTitle>
              <CardDescription>
                Configure how long activity data is retained
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <label htmlFor="hotDays" className="text-sm font-medium">
                    Hot retention (days)
                  </label>
                  <Input
                    id="hotDays"
                    type="number"
                    value={hotDays}
                    onChange={(e) => setHotDays(e.target.value)}
                    min={1}
                  />
                  <p className="text-xs text-muted-foreground">
                    Recent data kept in full detail
                  </p>
                </div>
                <div className="space-y-2">
                  <label htmlFor="warmDays" className="text-sm font-medium">
                    Warm retention (days)
                  </label>
                  <Input
                    id="warmDays"
                    type="number"
                    value={warmDays}
                    onChange={(e) => setWarmDays(e.target.value)}
                    min={1}
                  />
                  <p className="text-xs text-muted-foreground">
                    Older data retained with summaries
                  </p>
                </div>
                <div className="space-y-2">
                  <label
                    htmlFor="maxOutputSize"
                    className="text-sm font-medium"
                  >
                    Max output size (chars)
                  </label>
                  <Input
                    id="maxOutputSize"
                    type="number"
                    value={maxOutputSize}
                    onChange={(e) => setMaxOutputSize(e.target.value)}
                    min={100}
                  />
                  <p className="text-xs text-muted-foreground">
                    Maximum captured output per activity
                  </p>
                </div>
              </div>
            </CardContent>
            <CardFooter className="flex gap-2">
              <Button onClick={handleSaveRetention} disabled={isSaving}>
                <Save className="mr-2 h-4 w-4" />
                {isSaving ? "Saving..." : "Save"}
              </Button>
              <Button
                variant="outline"
                onClick={handleCleanup}
                disabled={isCleaningUp}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                {isCleaningUp ? "Running..." : "Run Cleanup Now"}
              </Button>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <HardDrive className="h-5 w-5" />
                Database Statistics
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg border p-3">
                  <p className="text-sm text-muted-foreground">File Size</p>
                  <p className="text-2xl font-bold">
                    {formatBytes(data.dbStats.fileSizeBytes)}
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-sm text-muted-foreground">
                    Total Activities
                  </p>
                  <p className="text-2xl font-bold">
                    {data.dbStats.totalActivities.toLocaleString()}
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-sm text-muted-foreground">Sessions</p>
                  <p className="text-2xl font-bold">
                    {data.dbStats.totalSessions.toLocaleString()}
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-sm text-muted-foreground">
                    LLM Generations
                  </p>
                  <p className="text-2xl font-bold">
                    {data.dbStats.totalGenerations.toLocaleString()}
                  </p>
                </div>
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-3">
                  <p className="text-sm text-muted-foreground">
                    Hot (last 7 days)
                  </p>
                  <p className="text-xl font-semibold">
                    {data.dbStats.hotActivities.toLocaleString()}
                  </p>
                </div>
                <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-3">
                  <p className="text-sm text-muted-foreground">
                    Warm (7-90 days)
                  </p>
                  <p className="text-xl font-semibold">
                    {data.dbStats.warmActivities.toLocaleString()}
                  </p>
                </div>
                <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
                  <p className="text-sm text-muted-foreground">
                    Cold (90+ days)
                  </p>
                  <p className="text-xl font-semibold">
                    {data.dbStats.coldActivities.toLocaleString()}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Profiles Tab */}
        <TabsContent value="profiles">
          <Card>
            <CardHeader>
              <CardTitle>Profiles</CardTitle>
              <CardDescription>
                OpenClaw profiles and their activity statistics
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data.profiles.length === 0 ? (
                <p className="py-6 text-center text-muted-foreground">
                  No profiles found
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="px-4 py-2 text-left font-medium text-muted-foreground">
                          Profile ID
                        </th>
                        <th className="px-4 py-2 text-left font-medium text-muted-foreground">
                          Name
                        </th>
                        <th className="px-4 py-2 text-right font-medium text-muted-foreground">
                          Activity Count
                        </th>
                        <th className="px-4 py-2 text-right font-medium text-muted-foreground">
                          Last Activity
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.profiles.map((profile) => (
                        <tr key={profile.id} className="border-b last:border-0">
                          <td className="px-4 py-2 font-mono text-xs">
                            {profile.id}
                          </td>
                          <td className="px-4 py-2">{profile.name}</td>
                          <td className="px-4 py-2 text-right">
                            {profile.activityCount.toLocaleString()}
                          </td>
                          <td className="px-4 py-2 text-right text-muted-foreground">
                            {formatDate(profile.lastActivity)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* System Tab */}
        <TabsContent value="system" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>System Information</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">API Port</p>
                  <p className="font-mono">{data.config.apiPort}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Node Version</p>
                  <p className="font-mono">{data.config.nodeVersion}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Database Path</p>
                  <p
                    className="truncate font-mono text-xs"
                    title={data.config.dbPath}
                  >
                    {data.config.dbPath}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Scan State</CardTitle>
              <CardDescription>Session log scanner progress</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Last Scan</p>
                  <p className="font-mono text-sm">
                    {formatDate(data.scanState.lastScanTime)}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Files Tracked</p>
                  <p className="font-mono">{data.scanState.filesTracked}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">
                    Generations Scanned
                  </p>
                  <p className="font-mono">
                    {data.scanState.generationsScanned.toLocaleString()}
                  </p>
                </div>
              </div>
            </CardContent>
            <CardFooter>
              {showResetConfirm ? (
                <div className="flex items-center gap-2">
                  <p className="text-sm text-muted-foreground">
                    This will trigger a full rescan. Continue?
                  </p>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleResetScan}
                    disabled={isResettingScan}
                  >
                    {isResettingScan ? "Resetting..." : "Confirm"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowResetConfirm(false)}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => setShowResetConfirm(true)}
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Reset Scan State
                </Button>
              )}
            </CardFooter>
          </Card>
        </TabsContent>

        {/* About Tab */}
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
                  Activity monitoring dashboard for the OpenClaw agent system.
                  Provides real-time visibility into agent activities, costs,
                  and system health.
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

      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}
