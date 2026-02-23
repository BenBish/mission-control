import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { ThemeProvider } from "@/app/providers";
import { ActivityStreamProvider } from "@/app/agents/context/ActivityStreamContext";
import { router } from "@/app/router";
import { ErrorBoundary } from "@/components/_shared/ErrorBoundary";
import "@/styles/globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider defaultTheme="system">
        <ActivityStreamProvider>
          <RouterProvider router={router} />
        </ActivityStreamProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
);
