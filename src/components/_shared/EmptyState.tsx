/**
 * Contextual empty / unavailable state for list pages.
 *
 * Distinguishes not configured, disabled, no data, and error so operators
 * get a useful next step instead of a blank card.
 */

import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import { AlertCircle, BookOpen, Settings } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { WorkloadPageState } from "@/lib/workload-availability";
import { cn } from "@/lib/utils";

export interface EmptyStateAction {
  label: string;
  /** Internal route (preferred) or external URL. */
  href: string;
  external?: boolean;
  variant?: "default" | "outline" | "secondary" | "ghost" | "link";
}

export interface EmptyStateProps {
  state: WorkloadPageState;
  icon: LucideIcon;
  title: string;
  description: string;
  /** Optional secondary detail (env flag, source name, etc.). */
  detail?: string;
  actions?: EmptyStateAction[];
  className?: string;
  children?: ReactNode;
}

function stateBorderClass(state: WorkloadPageState): string {
  if (state === "error") return "border-destructive";
  if (state === "disabled" || state === "not_configured")
    return "border-dashed";
  return "";
}

export function EmptyState({
  state,
  icon: Icon,
  title,
  description,
  detail,
  actions,
  className,
  children,
}: EmptyStateProps) {
  const isError = state === "error";

  return (
    <Card className={cn(stateBorderClass(state), className)}>
      <CardContent className="py-12 text-center">
        {isError ? (
          <AlertCircle className="mx-auto h-12 w-12 text-destructive/70" />
        ) : (
          <Icon className="mx-auto h-12 w-12 text-muted-foreground/30" />
        )}
        <p
          className={cn(
            "mt-4 font-medium",
            isError ? "text-destructive" : "text-foreground",
          )}
        >
          {title}
        </p>
        <p className="mt-1 text-sm text-muted-foreground max-w-md mx-auto">
          {description}
        </p>
        {detail && (
          <p className="mt-2 text-xs text-muted-foreground font-mono max-w-lg mx-auto">
            {detail}
          </p>
        )}
        {children}
        {actions && actions.length > 0 && (
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            {actions.map((action) =>
              action.external ? (
                <Button
                  key={action.href + action.label}
                  variant={action.variant ?? "outline"}
                  size="sm"
                  asChild
                >
                  <a
                    href={action.href}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <BookOpen className="h-3.5 w-3.5" />
                    {action.label}
                  </a>
                </Button>
              ) : (
                <Button
                  key={action.href + action.label}
                  variant={action.variant ?? "outline"}
                  size="sm"
                  asChild
                >
                  <Link to={action.href}>
                    {action.href.startsWith("/settings") && (
                      <Settings className="h-3.5 w-3.5" />
                    )}
                    {action.label}
                  </Link>
                </Button>
              ),
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
