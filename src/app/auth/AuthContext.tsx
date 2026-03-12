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

interface AuthUser {
  username: string;
}

interface AuthContextType {
  /** Current authenticated user, null if not logged in */
  user: AuthUser | null;
  /** Whether auth is enabled on the server */
  authEnabled: boolean;
  /** Whether the initial auth check is still in progress */
  loading: boolean;
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

  const checkAuth = useCallback(async () => {
    try {
      const res = await apiFetch("/api/auth/me");
      const data = await res.json();

      if (res.ok && data.success) {
        setUser(data.user);
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
      value={{ user, authEnabled, loading, checkAuth, logout }}
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
