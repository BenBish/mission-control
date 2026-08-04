/**
 * Workload availability for Jobs / Generations navigation and empty states.
 *
 * Derives from the seeded source registry + instance heartbeats (GET /api/sources).
 * Intentionally quiet sources report status "off" (ComfyUI / Lemonade defaults).
 */

import type { Source } from "@/lib/queries";

export type WorkloadId = "jobs" | "generations";

/**
 * Page / empty-state modes. Loading and fetch-error are handled by list hooks;
 * this type covers source-driven availability and empty data.
 */
export type WorkloadPageState =
  | "not_configured"
  | "disabled"
  | "error"
  | "no_data"
  | "available";

/** How prominently a workload should appear in primary navigation. */
export type WorkloadNavEmphasis = "primary" | "deemphasized" | "hidden";

export interface WorkloadAvailability {
  workloadId: WorkloadId;
  /** Related source ids that feed this workload (registry keys). */
  sourceIds: string[];
  /** True when at least one related source row exists in the registry. */
  configured: boolean;
  /**
   * True when any related instance is not intentionally off — collectors may
   * be running or unknown (agentic sources often start as "unknown").
   */
  available: boolean;
  /** True when any related instance reports status "error". */
  hasError: boolean;
  /** Aggregate for empty states once list data is empty. */
  pageState: WorkloadPageState;
  /** Nav presentation when the workload has no live data signal. */
  navEmphasis: WorkloadNavEmphasis;
  /** Short label for nav badges (e.g. "Off"). */
  navBadge?: string;
  reason?: string;
}

/** Sources that emit background_jobs (Hermes + agent collectors). */
const JOBS_SOURCE_IDS = [
  "hermes",
  "claude-code",
  "codex",
  "grok",
  "opencode",
  "lemonade",
] as const;

/** Sources that emit generation jobs (ComfyUI today). */
const GENERATIONS_SOURCE_IDS = ["comfyui"] as const;

export function workloadSourceIds(workloadId: WorkloadId): readonly string[] {
  return workloadId === "jobs" ? JOBS_SOURCE_IDS : GENERATIONS_SOURCE_IDS;
}

function relatedSources(
  sources: Source[] | undefined,
  workloadId: WorkloadId,
): Source[] {
  const ids = new Set(workloadSourceIds(workloadId));
  return (sources ?? []).filter((s) => ids.has(s.id));
}

function allInstances(sources: Source[]) {
  return sources.flatMap((s) => s.instances);
}

/**
 * Resolve availability for a workload from the current source registry.
 * Pure — safe for unit tests without React.
 */
export function getWorkloadAvailability(
  workloadId: WorkloadId,
  sources: Source[] | undefined,
): WorkloadAvailability {
  // Sources still loading — keep nav items visible at full emphasis to avoid flash.
  if (sources === undefined) {
    return {
      workloadId,
      sourceIds: [...workloadSourceIds(workloadId)],
      configured: true,
      available: true,
      hasError: false,
      pageState: "available",
      navEmphasis: "primary",
    };
  }

  const related = relatedSources(sources, workloadId);
  const sourceIds = related.map((s) => s.id);
  const instances = allInstances(related);

  if (related.length === 0) {
    return {
      workloadId,
      sourceIds: [...workloadSourceIds(workloadId)],
      configured: false,
      available: false,
      hasError: false,
      pageState: "not_configured",
      navEmphasis: "hidden",
      navBadge: "N/A",
      reason:
        workloadId === "generations"
          ? "No generation source is registered in this deployment."
          : "No job-producing sources are registered in this deployment.",
    };
  }

  if (instances.length === 0) {
    return {
      workloadId,
      sourceIds,
      configured: true,
      available: false,
      hasError: false,
      pageState: "not_configured",
      navEmphasis: "deemphasized",
      navBadge: "Setup",
      reason: "Source is registered but has no collector instances.",
    };
  }

  const hasError = instances.some(
    (i) => (i.status ?? "").toLowerCase() === "error",
  );
  const nonOff = instances.filter(
    (i) => (i.status ?? "").toLowerCase() !== "off",
  );
  const available = nonOff.length > 0;

  if (!available) {
    // All instances intentionally off — feature not enabled in this deploy.
    // (An instance cannot be both status "off" and "error", so hasError is unused here.)
    return {
      workloadId,
      sourceIds,
      configured: true,
      available: false,
      hasError: false,
      pageState: "disabled",
      navEmphasis: "deemphasized",
      navBadge: "Off",
      reason:
        workloadId === "generations"
          ? "ComfyUI polling is offline — enable MC_COMFYUI_POLLING_ENABLED and run the ComfyUI service."
          : "Job collectors are offline for related sources.",
    };
  }

  if (
    hasError &&
    nonOff.every((i) => (i.status ?? "").toLowerCase() === "error")
  ) {
    // Collectors exist but are unhealthy — keep visible with Error badge.
    return {
      workloadId,
      sourceIds,
      configured: true,
      available: true,
      hasError: true,
      pageState: "error",
      navEmphasis: "deemphasized",
      navBadge: "Error",
      reason: "Related collectors reported errors.",
    };
  }

  return {
    workloadId,
    sourceIds,
    configured: true,
    available: true,
    hasError,
    pageState: "available",
    navEmphasis: "primary",
    reason: undefined,
  };
}

/**
 * Empty-list page state: combines source availability with "no rows yet".
 * Call only when the list query succeeded with zero items.
 */
export function getEmptyWorkloadPageState(
  availability: WorkloadAvailability,
): WorkloadPageState {
  if (availability.pageState === "not_configured") return "not_configured";
  if (availability.pageState === "disabled") return "disabled";
  if (availability.pageState === "error") return "error";
  // pageState "available" with zero list rows → empty-but-ready
  return "no_data";
}

/** Whether nav should show this workload link (hidden = omit from sidebar). */
export function shouldShowWorkloadInNav(
  availability: WorkloadAvailability,
): boolean {
  return availability.navEmphasis !== "hidden";
}

export interface WorkloadSetupAction {
  label: string;
  href: string;
  external?: boolean;
  variant?: "default" | "outline" | "secondary" | "ghost" | "link";
}

/** Shared setup actions for disabled / not-configured workloads. */
export function workloadSetupActions(
  workloadId: WorkloadId,
): WorkloadSetupAction[] {
  const actions: WorkloadSetupAction[] = [
    {
      label: "View sources",
      href: "/settings?tab=sources",
      variant: "outline",
    },
  ];
  if (workloadId === "generations") {
    actions.push({
      label: "Deployment docs",
      href: "https://github.com/BenBish/mission-control/blob/main/docs/DEPLOYMENT.md",
      external: true,
      variant: "outline",
    });
  }
  return actions;
}
