/**
 * useProfile — Profile context for the frontend.
 *
 * Provides the currently active profile ID and a setter to change it.
 * Persists the selection in localStorage so it survives page reloads.
 *
 * Components that need the active profile should call `useProfile()`.
 * The `<ProfileProvider>` must be mounted near the app root.
 */

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProfileContextValue {
  /** Currently active profile ID */
  profileId: string;
  /** Change the active profile */
  setProfileId: (id: string) => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY = "mission-control:activeProfile";
const DEFAULT_PROFILE = "default";

// ─── Context ─────────────────────────────────────────────────────────────────

const ProfileContext = createContext<ProfileContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

interface ProfileProviderProps {
  children: ReactNode;
  /** Override the initial profile (e.g. from URL). Falls back to localStorage then "default". */
  initialProfileId?: string;
}

export function ProfileProvider({
  children,
  initialProfileId,
}: ProfileProviderProps) {
  const [profileId, setProfileIdState] = useState<string>(() => {
    if (initialProfileId) return initialProfileId;
    try {
      return localStorage.getItem(STORAGE_KEY) || DEFAULT_PROFILE;
    } catch {
      return DEFAULT_PROFILE;
    }
  });

  const setProfileId = useCallback((id: string) => {
    setProfileIdState(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // localStorage may be unavailable in some contexts
    }
  }, []);

  return (
    <ProfileContext.Provider value={{ profileId, setProfileId }}>
      {children}
    </ProfileContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Access the active profile ID and setter.
 * Must be used within a `<ProfileProvider>`.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useProfile(): ProfileContextValue {
  const ctx = useContext(ProfileContext);
  if (!ctx) {
    throw new Error("useProfile must be used within a <ProfileProvider>");
  }
  return ctx;
}
