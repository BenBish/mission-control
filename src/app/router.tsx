import { createBrowserRouter, Navigate } from "react-router-dom";
import { Suspense, lazy } from "react";
import { MainLayout } from "@/components/_shared/MainLayout";
import { Loading } from "@/components/_shared/Loading";

// Lazy load pages
const DashboardPage = lazy(() => import("@/pages/DashboardPage"));
const ActivityFeed = lazy(() => import("@/pages/ActivityFeed"));
const ActivityDetail = lazy(() => import("@/pages/ActivityDetail"));
const Consumption = lazy(() => import("@/pages/Consumption"));
const SessionsPage = lazy(() => import("@/app/sessions/page"));
const SessionDetail = lazy(() => import("@/app/sessions/pages/SessionDetail"));
const JobsPage = lazy(() => import("@/app/jobs/page"));
const SettingsPage = lazy(() => import("@/app/settings/page"));
const FailureAnalysis = lazy(() => import("@/pages/FailureAnalysis"));

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
        path: "consumption",
        element: withSuspense(Consumption),
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
        path: "failures",
        element: withSuspense(FailureAnalysis),
      },
      {
        path: "jobs",
        element: withSuspense(JobsPage),
      },
      {
        path: "jobs/:jobId",
        element: withSuspense(JobsPage),
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
