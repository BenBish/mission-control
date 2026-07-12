/**
 * Settings Page
 * Sources & Instances (live registry) and About.
 */

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
import { AlertCircle, Info, Server } from "lucide-react";
import { useSources } from "@/lib/queries";

const STATUS_VARIANT: Record<
  string,
  "success" | "destructive" | "secondary" | "outline"
> = {
  ok: "success",
  error: "destructive",
  off: "outline",
  unknown: "secondary",
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Never";
  return new Date(dateStr).toLocaleString();
}

export default function SettingsPage() {
  const { data: sources, isLoading, error } = useSources();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Source registry and application info"
      />

      <Tabs defaultValue="sources">
        <TabsList>
          <TabsTrigger value="sources">
            <Server className="mr-2 h-4 w-4" />
            Sources & Instances
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
                startup. Status/last-seen update as collectors send heartbeats.
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
                        source.instances.map((instance) => (
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
                                variant={
                                  STATUS_VARIANT[instance.status] ?? "secondary"
                                }
                                className="capitalize"
                              >
                                {instance.status}
                              </Badge>
                              {instance.lastError && (
                                <p className="mt-1 text-xs text-destructive">
                                  {instance.lastError}
                                </p>
                              )}
                            </td>
                            <td className="px-4 py-2 text-right text-muted-foreground">
                              {formatDate(instance.lastSeenAt)}
                            </td>
                          </tr>
                        )),
                      )}
                    </tbody>
                  </table>
                </div>
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
