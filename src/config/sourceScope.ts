/**
 * Source-scope contract for Mission Control views and datasets.
 *
 * The header source selector is global. Every page/dataset must either:
 *   - filterable: pass selectedSourceId on compatible API queries
 *   - mixed: filter agent/session data; label account-wide sections
 *   - unscoped: disable/contextualize the selector (data is fleet-wide)
 *
 * Account-wide datasets (provider billing APIs) never take sourceId —
 * they are labeled in the UI and ignore the selector.
 */

export type RouteScopeMode = "filterable" | "mixed" | "unscoped";

export type DatasetMode =
  /** Include selected sourceId on the API request when set. */
  | "filterable"
  /** Always all sources / account-wide; never pass sourceId. */
  | "account-wide"
  /** Fleet registry view (e.g. source health chips); not filtered. */
  | "fleet";

export interface DatasetScope {
  id: string;
  page: string;
  mode: DatasetMode;
  /** React Query root key when this dataset is filterable. */
  queryKey?: string;
  description: string;
}

/**
 * Per-dataset contract. Keep in sync with hooks in `src/lib/queries.ts`
 * and page components under `src/pages` / `src/app`.
 */
export const DATASET_SCOPES: readonly DatasetScope[] = [
  {
    id: "activities",
    page: "Dashboard / Activity Feed",
    mode: "filterable",
    queryKey: "activities",
    description: "Activity list and recent activity widgets",
  },
  {
    id: "sessions",
    page: "Sessions",
    mode: "filterable",
    queryKey: "sessions",
    description: "Session list",
  },
  {
    id: "failures",
    page: "Dashboard / Failure Analysis",
    mode: "filterable",
    queryKey: "failures",
    description: "Failed activities, inference requests, runtime events",
  },
  {
    id: "consumption",
    page: "Dashboard / Consumption",
    mode: "filterable",
    queryKey: "consumption",
    description: "Agent/session-log token and compute rollups",
  },
  {
    id: "jobs",
    page: "Jobs",
    mode: "filterable",
    queryKey: "jobs",
    description: "Background jobs observed per source",
  },
  {
    id: "generations",
    page: "Generations",
    mode: "filterable",
    queryKey: "generations",
    description: "ComfyUI (and similar) generation jobs",
  },
  {
    id: "provider-billing",
    page: "Consumption",
    mode: "account-wide",
    queryKey: "provider-breakdown",
    description:
      "Provider API usage/cost (OpenRouter, Anthropic, OpenAI, xAI) — account-level billing, not agent sources",
  },
  {
    id: "provider-status",
    page: "Consumption",
    mode: "account-wide",
    queryKey: "provider-status",
    description: "Provider connector sync status",
  },
  {
    id: "source-health",
    page: "Dashboard",
    mode: "fleet",
    queryKey: "sources",
    description: "Source instance health badges (always fleet-wide)",
  },
  {
    id: "runtime",
    page: "Runtime",
    mode: "fleet",
    queryKey: "runtime",
    description: "Hermes inference fleet telemetry (slots, requests, events)",
  },
] as const;

export interface RouteScope {
  mode: RouteScopeMode;
  /** Shown when the selector is disabled (unscoped routes). */
  reason?: string;
  /** Optional note for mixed pages (e.g. provider billing still account-wide). */
  note?: string;
}

/**
 * Path prefixes → how the global source selector should behave.
 * More specific prefixes should be longer (matched longest-first).
 */
export const ROUTE_SCOPES: Record<string, RouteScope> = {
  "/": { mode: "filterable" },
  "/activities": { mode: "filterable" },
  "/sessions": { mode: "filterable" },
  "/failures": { mode: "filterable" },
  "/jobs": { mode: "filterable" },
  "/generations": { mode: "filterable" },
  "/consumption": {
    mode: "mixed",
    note: "Agent usage respects the source filter; provider API costs are account-wide",
  },
  "/runtime": {
    mode: "unscoped",
    reason: "Runtime shows fleet-wide inference telemetry",
  },
  "/settings": {
    mode: "unscoped",
    reason: "Settings are not source-scoped",
  },
};

/** Resolve route scope for a location pathname. */
export function getRouteScope(pathname: string): RouteScope {
  if (pathname === "/" || pathname === "") {
    return ROUTE_SCOPES["/"];
  }
  const keys = Object.keys(ROUTE_SCOPES)
    .filter((k) => k !== "/")
    .sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (pathname === key || pathname.startsWith(`${key}/`)) {
      return ROUTE_SCOPES[key];
    }
  }
  // Detail-only or unknown routes: keep selector active (filterable default).
  return { mode: "filterable" };
}

/** True when the header source selector should be interactive. */
export function isSourceSelectorEnabled(pathname: string): boolean {
  const scope = getRouteScope(pathname);
  return scope.mode !== "unscoped";
}

/**
 * Human-readable scope phrase for page descriptions.
 * e.g. "across all sources" | "for Grok"
 */
export function scopePhrase(
  selectedSourceId: string | undefined,
  sources?: { id: string; name: string }[],
): string {
  if (!selectedSourceId) return "across all sources";
  const name = sources?.find((s) => s.id === selectedSourceId)?.name;
  return name ? `for ${name}` : `for ${selectedSourceId}`;
}
