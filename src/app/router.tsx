import { createBrowserRouter, Navigate } from "react-router-dom";
import { Suspense, lazy } from "react";
import { MainLayout } from "@/components/_shared/MainLayout";
import { Loading } from "@/components/_shared/Loading";

// Lazy load pages
const DashboardPage = lazy(() => import("@/pages/DashboardPage"));
const ActivityFeed = lazy(() => import("@/pages/ActivityFeed"));
const ActivityDetail = lazy(() => import("@/pages/ActivityDetail"));
const CostBreakdown = lazy(() => import("@/pages/CostBreakdown"));
const AgentsPage = lazy(() => import("@/app/agents/page"));
const AgentDetail = lazy(() => import("@/app/agents/pages/AgentDetail"));
const SessionsPage = lazy(() => import("@/app/sessions/page"));
const SessionDetail = lazy(() => import("@/app/sessions/pages/SessionDetail"));
const SkillsPage = lazy(() => import("@/app/skills/page"));
const SkillDetail = lazy(() => import("@/app/skills/pages/SkillDetail"));
const CronPage = lazy(() =>
  import("@/app/cron/page").then((m) => ({ default: m.CronPage })),
);
const PermissionsPage = lazy(() => import("@/app/permissions/page"));
const SettingsPage = lazy(() => import("@/app/settings/page"));

function withSuspense(Component: React.ComponentType) {
  return (
    <Suspense fallback={<Loading />}>
      <Component />
    </Suspense>
  );
}

export const router = createBrowserRouter([
  {
    path: "/",
    element: <MainLayout />,
    children: [
      {
        index: true,
        element: withSuspense(DashboardPage),
      },
      {
        path: "activities",
        element: withSuspense(ActivityFeed),
      },
      {
        path: "activities/:id",
        element: withSuspense(ActivityDetail),
      },
      {
        path: "costs",
        element: withSuspense(CostBreakdown),
      },
      {
        path: "sessions",
        element: withSuspense(SessionsPage),
      },
      {
        path: "sessions/:id",
        element: withSuspense(SessionDetail),
      },
      {
        path: "agents",
        element: withSuspense(AgentsPage),
      },
      {
        path: "agents/:id",
        element: withSuspense(AgentDetail),
      },
      {
        path: "skills",
        element: withSuspense(SkillsPage),
      },
      {
        path: "skills/:id",
        element: withSuspense(SkillDetail),
      },
      {
        path: "cron",
        element: withSuspense(CronPage),
      },
      {
        path: "cron/:jobId",
        element: withSuspense(CronPage),
      },
      {
        path: "permissions",
        element: withSuspense(PermissionsPage),
      },
      {
        path: "users",
        element: (
          <div className="flex h-full items-center justify-center">
            <p className="text-muted-foreground">Users page (coming soon)</p>
          </div>
        ),
      },
      {
        path: "settings",
        element: withSuspense(SettingsPage),
      },
      {
        path: "*",
        element: <Navigate to="/" replace />,
      },
    ],
  },
]);
