import { cn } from "@/lib/utils";
import type { WorkspaceFile } from "@/types/agent";
import { FileText, FileJson, Star } from "lucide-react";

const CANONICAL_FILES = new Set([
  "SOUL.md",
  "AGENTS.md",
  "HEARTBEAT.md",
  "TOOLS.md",
  "USER.md",
  "IDENTITY.md",
]);

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface WorkspaceFileTreeProps {
  files: WorkspaceFile[];
  selectedFile: string | null;
  onSelectFile: (name: string) => void;
  isLoading: boolean;
}

export function WorkspaceFileTree({
  files,
  selectedFile,
  onSelectFile,
  isLoading,
}: WorkspaceFileTreeProps) {
  if (isLoading) {
    return (
      <div className="space-y-2 p-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-10 animate-pulse rounded bg-muted" />
        ))}
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        No files found in workspace
      </p>
    );
  }

  return (
    <div className="space-y-0.5 p-1">
      {files.map((file) => {
        const isCanonical = CANONICAL_FILES.has(file.name);
        const isSelected = file.name === selectedFile;

        return (
          <button
            key={file.name}
            onClick={() => onSelectFile(file.name)}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors",
              "hover:bg-accent hover:text-accent-foreground",
              isSelected && "bg-accent text-accent-foreground",
            )}
          >
            {file.type === "markdown" ? (
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <FileJson className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span
                  className={cn("truncate", isCanonical && "font-semibold")}
                >
                  {file.name}
                </span>
                {isCanonical && (
                  <Star className="h-3 w-3 shrink-0 text-amber-500" />
                )}
              </div>
              <span className="text-xs text-muted-foreground">
                {formatFileSize(file.size)}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
