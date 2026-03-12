import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, GitBranch, ExternalLink } from "lucide-react";
import { formatLastActive } from "@/lib/date-utils";
import type { ArchieTaskStatus } from "../hooks/useArchieStatus";

interface ArchieTaskListProps {
  tasks: ArchieTaskStatus[];
  isLoading: boolean;
}

const STATE_BADGES: Record<string, { label: string; className: string }> = {
  running: {
    label: "Running",
    className:
      "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800",
  },
  in_progress: {
    label: "In Progress",
    className:
      "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800",
  },
  awaiting_pr: {
    label: "Awaiting PR",
    className:
      "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800",
  },
  awaiting_review: {
    label: "Awaiting Review",
    className:
      "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800",
  },
  awaiting_ci: {
    label: "Awaiting CI",
    className:
      "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-800",
  },
  done: {
    label: "Done",
    className:
      "bg-gray-50 text-gray-600 border-gray-200 dark:bg-gray-950/30 dark:text-gray-400 dark:border-gray-700",
  },
  cancelled: {
    label: "Cancelled",
    className:
      "bg-red-50 text-red-600 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-800",
  },
  blocked: {
    label: "Blocked",
    className:
      "bg-red-50 text-red-600 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-800",
  },
  ready_for_merge: {
    label: "Ready to Merge",
    className:
      "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/30 dark:text-purple-400 dark:border-purple-800",
  },
};

function getStateBadge(state: string) {
  const config = STATE_BADGES[state] || {
    label: state,
    className: "",
  };
  return <Badge className={config.className}>{config.label}</Badge>;
}

export function ArchieTaskList({ tasks, isLoading }: ArchieTaskListProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Recent Tasks</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Loading tasks...</p>
        </CardContent>
      </Card>
    );
  }

  if (tasks.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Recent Tasks</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No tasks found</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Tasks</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {tasks.map((task) => (
          <div
            key={task.task_id}
            className="flex items-start justify-between gap-3 rounded-lg border p-3"
          >
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">
                  {task.task_id}
                </span>
                {getStateBadge(task.state)}
              </div>
              <p className="text-sm font-medium truncate">{task.title}</p>
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {formatLastActive(task.updated_at)}
                </span>
                {task.branch && (
                  <span className="flex items-center gap-1">
                    <GitBranch className="h-3 w-3" />
                    <span className="font-mono truncate max-w-[200px]">
                      {task.branch}
                    </span>
                  </span>
                )}
                {task.linear?.url && (
                  <a
                    href={task.linear.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 hover:text-primary"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ExternalLink className="h-3 w-3" />
                    Linear
                  </a>
                )}
              </div>
              {task.result?.summary && (
                <p className="text-xs text-muted-foreground mt-1">
                  {task.result.summary}
                </p>
              )}
              {task.result?.last_error && (
                <p className="text-xs text-red-500 dark:text-red-400 mt-1">
                  {task.result.last_error}
                </p>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
