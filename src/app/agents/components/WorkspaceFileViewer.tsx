import { SOULMarkdownViewer } from "./SOULMarkdownViewer";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { FileText, Clock } from "lucide-react";
import { Loading } from "@/components/_shared/Loading";
import type { WorkspaceFile } from "@/types/agent";

interface WorkspaceFileViewerProps {
  filename: string | null;
  content: string | null;
  fileType: "markdown" | "json" | null;
  isLoading: boolean;
  error: string | null;
  fileMeta?: WorkspaceFile;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function WorkspaceFileViewer({
  filename,
  content,
  fileType,
  isLoading,
  error,
  fileMeta,
}: WorkspaceFileViewerProps) {
  if (!filename) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="text-center text-muted-foreground">
          <FileText className="mx-auto h-10 w-10 mb-2 opacity-40" />
          <p className="text-sm">Select a file to view its contents</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <Loading />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header bar */}
      <div className="flex items-center justify-between border-b px-4 py-2">
        <span className="font-mono text-sm font-medium">{filename}</span>
        {fileMeta?.modifiedAt && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            {formatDate(fileMeta.modifiedAt)}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {fileType === "markdown" && content ? (
          <SOULMarkdownViewer markdown={content} />
        ) : fileType === "json" && content ? (
          <SyntaxHighlighter
            language="json"
            style={oneDark}
            className="rounded-lg overflow-x-auto"
            PreTag="div"
          >
            {content}
          </SyntaxHighlighter>
        ) : (
          <p className="text-sm text-muted-foreground">No content available</p>
        )}
      </div>
    </div>
  );
}
