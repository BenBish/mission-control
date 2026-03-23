import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { WorkspaceFileTree } from "./WorkspaceFileTree";
import { WorkspaceFileViewer } from "./WorkspaceFileViewer";
import { useAgentFiles, useAgentFileContent } from "../hooks/useAgents";
import type { AgentDetail } from "@/types/agent";
import { Cpu, FolderOpen, GitBranch, User, Zap } from "lucide-react";

interface AgentConfigPanelProps {
  agent: AgentDetail;
  profileId?: string;
}

export function AgentConfigPanel({ agent, profileId }: AgentConfigPanelProps) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const { files, isLoading: filesLoading } = useAgentFiles(agent.id, profileId);
  const {
    content,
    fileType,
    isLoading: contentLoading,
    error: contentError,
  } = useAgentFileContent(agent.id, selectedFile, profileId);

  const config = agent.config;
  const fileMeta = files.find((f) => f.name === selectedFile);

  return (
    <div className="space-y-4">
      {/* Config summary strip */}
      {config && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Configuration Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {config.model && (
                <div className="flex items-start gap-2">
                  <Cpu className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Model</p>
                    <p className="font-mono text-sm">{config.model}</p>
                  </div>
                </div>
              )}
              {config.workspace && (
                <div className="flex items-start gap-2">
                  <FolderOpen className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">Workspace</p>
                    <p className="break-all font-mono text-xs">
                      {config.workspace}
                    </p>
                  </div>
                </div>
              )}
              {config.gitConfig &&
                (config.gitConfig.author || config.gitConfig.email) && (
                  <div className="flex items-start gap-2">
                    <GitBranch className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Git Identity
                      </p>
                      <Badge
                        variant="outline"
                        className="font-mono text-xs mt-1"
                      >
                        {config.gitConfig.author && config.gitConfig.email
                          ? `${config.gitConfig.author} <${config.gitConfig.email}>`
                          : config.gitConfig.author || config.gitConfig.email}
                      </Badge>
                    </div>
                  </div>
                )}
              {config.identity && (
                <div className="flex items-start gap-2">
                  <User className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Identity</p>
                    <p className="text-sm">
                      {config.identity.emoji} {config.identity.name}
                    </p>
                  </div>
                </div>
              )}
              {config.skills && config.skills.length > 0 && (
                <div className="flex items-start gap-2">
                  <Zap className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Skills</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {config.skills.map((skill) => (
                        <Badge
                          key={skill}
                          variant="secondary"
                          className="text-xs"
                        >
                          {skill}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* File browser */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Workspace Files</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Separator />
          <div className="grid min-h-[400px] md:grid-cols-[2fr_3fr]">
            {/* Left: file tree */}
            <div className="border-b md:border-b-0 md:border-r overflow-y-auto max-h-[600px]">
              <WorkspaceFileTree
                files={files}
                selectedFile={selectedFile}
                onSelectFile={setSelectedFile}
                isLoading={filesLoading}
              />
            </div>

            {/* Right: file viewer */}
            <div className="max-h-[600px] overflow-hidden">
              <WorkspaceFileViewer
                filename={selectedFile}
                content={content}
                fileType={fileType}
                isLoading={contentLoading}
                error={contentError}
                fileMeta={fileMeta}
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
