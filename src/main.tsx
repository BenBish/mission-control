import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@/app/providers";
import { SourceProvider } from "@/app/source-context";
import { AuthProvider } from "@/app/auth/AuthContext";
import { AuthGuard } from "@/app/auth/AuthGuard";
import { router } from "@/app/router";
import { ErrorBoundary } from "@/components/_shared/ErrorBoundary";
import "@/styles/globals.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider defaultTheme="system">
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <AuthGuard>
              <SourceProvider>
                <RouterProvider router={router} />
              </SourceProvider>
            </AuthGuard>
          </AuthProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
);
