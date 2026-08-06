/**
 * Auth Context
 * Manages authentication state for the frontend.
 * Uses HttpOnly cookies — no tokens stored in JS.
 * Checks /api/auth/me on mount to determine auth state.
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { setUnauthorizedHandler, apiFetch } from "@/lib/api-client";

export type AuthRole = "owner" | "viewer";

interface AuthUser {
  username: string;
  role: AuthRole;
}

interface AuthContextType {
  /** Current authenticated user, null if not logged in */
  user: AuthUser | null;
  /** Whether auth is enabled on the server */
  authEnabled: boolean;
  /** Whether the initial auth check is still in progress */
  loading: boolean;
  /** True when production-style unsafe unauthenticated exposure is reported */
  securityWarning: string | null;
  /** Re-check auth status (e.g. after login) */
  checkAuth: () => Promise<void>;
  /** Logout and clear session */
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authEnabled, setAuthEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [securityWarning, setSecurityWarning] = useState<string | null>(null);

  const checkAuth = useCallback(async () => {
    try {
      const res = await apiFetch("/api/auth/me");
      const data = await res.json();

      if (res.ok && data.success) {
        const role: AuthRole =
          data.user?.role === "viewer" || data.user?.role === "owner"
            ? data.user.role
            : "owner";
        setUser(data.user ? { username: data.user.username, role } : null);
        setAuthEnabled(data.authEnabled !== false);
      } else {
        setUser(null);
        setAuthEnabled(true); // assume enabled if /me returns 401
      }
    } catch {
      // Server unreachable — treat as auth disabled so app can still render
      setUser(null);
      setAuthEnabled(false);
    } finally {
      setLoading(false);
    }

    // Non-blocking security posture check (also surfaces auth-off warning)
    try {
      const pol = await apiFetch("/api/privacy/policy");
      if (pol.ok) {
        const body = await pol.json();
        const warnings: string[] = body.warnings ?? [];
        if (warnings.length > 0) {
          setSecurityWarning(warnings[0]);
        } else if (body.policy?.unsafeUnauthenticated) {
          setSecurityWarning(
            "Authentication is disabled while serving potentially sensitive operational data.",
          );
        } else if (body.policy && body.policy.authEnabled === false) {
          setSecurityWarning(
            "App authentication is off. Anyone who can reach this host can read activity data.",
          );
        } else {
          setSecurityWarning(null);
        }
      }
    } catch {
      // ignore — policy endpoint may be unavailable during boot
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } catch {
      // ignore
    }
    setUser(null);
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // Register global 401 handler so any API call can trigger re-auth
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
    });
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        authEnabled,
        loading,
        securityWarning,
        checkAuth,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
