import { createBrowserRouter, Navigate } from "react-router-dom";
import { Suspense, lazy } from "react";
import { MainLayout } from "@/components/_shared/MainLayout";
import { Loading } from "@/components/_shared/Loading";

// Lazy load pages
const DashboardPage = lazy(() => import("@/pages/DashboardPage"));
const ActivityFeed = lazy(() => import("@/pages/ActivityFeed"));
const ActivityDetail = lazy(() => import("@/pages/ActivityDetail"));
const CostBreakdown = lazy(() => import("@/pages/CostBreakdown"));
const SkillsPage = lazy(() => import("@/app/skills/page"));

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
        path: "skills",
        element: withSuspense(SkillsPage),
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
        element: (
          <div className="flex h-full items-center justify-center">
            <p className="text-muted-foreground">Settings page (coming soon)</p>
          </div>
        ),
      },
      {
        path: "*",
        element: <Navigate to="/" replace />,
      },
    ],
  },
]);
