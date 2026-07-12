import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { ThemeProvider } from "@/app/providers";
import { ProfileProvider } from "@/app/profile-context";
import { AuthProvider } from "@/app/auth/AuthContext";
import { AuthGuard } from "@/app/auth/AuthGuard";
import { router } from "@/app/router";
import { ErrorBoundary } from "@/components/_shared/ErrorBoundary";
import "@/styles/globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider defaultTheme="system">
        <AuthProvider>
          <AuthGuard>
            <ProfileProvider>
              <RouterProvider router={router} />
            </ProfileProvider>
          </AuthGuard>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
);
