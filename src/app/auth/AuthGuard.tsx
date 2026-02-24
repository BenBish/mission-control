/**
 * Auth Guard
 * Wraps the main app to show login page when authentication is required.
 * When auth is disabled, passes through directly.
 */

import { useAuth } from "./AuthContext";
import { Loading } from "@/components/_shared/Loading";
import LoginPage from "./LoginPage";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, authEnabled, loading, checkAuth } = useAuth();

  // Still checking auth status
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loading />
      </div>
    );
  }

  // Auth disabled — allow through
  if (!authEnabled) {
    return <>{children}</>;
  }

  // Auth enabled but no user — show login
  if (!user) {
    return <LoginPage onLoginSuccess={checkAuth} />;
  }

  // Authenticated
  return <>{children}</>;
}
