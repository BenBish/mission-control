import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Profile } from "@/types/profile";
import { useProfiles } from "@/hooks/useProfiles";

const STORAGE_KEY = "openclaw-active-profile";

interface ProfileContextType {
  profiles: Profile[];
  activeProfile: Profile | null;
  /** Convenience shorthand: activeProfile?.id ?? "default" */
  profileId: string;
  setActiveProfile: (profile: Profile) => void;
  isLoadingProfiles: boolean;
  profilesError: string | null;
  isSwitching: boolean;
}

const ProfileContext = createContext<ProfileContextType | undefined>(undefined);

interface ProfileProviderProps {
  children: ReactNode;
}

/**
 * Derive the active profile from the profiles list without an effect.
 * Reads localStorage for the stored preference and falls back to the first
 * profile. Returns null when no profiles are available yet.
 */
function resolveActiveProfile(profiles: Profile[]): Profile | null {
  if (profiles.length === 0) return null;

  const storedId =
    typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;

  const stored = storedId ? profiles.find((p) => p.id === storedId) : null;

  if (stored) return stored;

  // Persist the fallback so future renders are consistent
  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEY, profiles[0].id);
  }
  return profiles[0];
}

export function ProfileProvider({ children }: ProfileProviderProps) {
  const {
    profiles,
    isLoading: isLoadingProfiles,
    error: profilesError,
  } = useProfiles();
  const [isSwitching, setIsSwitching] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Track a user-explicit selection (via setActiveProfile callback).
  // null means "use the derived value from profiles list".
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(
    () =>
      typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null,
  );

  // Derive active profile synchronously from profiles + selectedProfileId.
  // No effect / no setState needed — pure derivation.
  const activeProfile = useMemo(() => {
    if (profiles.length === 0) return null;

    if (selectedProfileId) {
      const found = profiles.find((p) => p.id === selectedProfileId);
      if (found) return found;
    }

    // Fallback: first profile
    return resolveActiveProfile(profiles);
  }, [profiles, selectedProfileId]);

  const setActiveProfile = useCallback((profile: Profile) => {
    setIsSwitching(true);
    setSelectedProfileId(profile.id);

    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, profile.id);
    }

    if (profile.status === "offline") {
      setToastMessage(
        `Profile '${profile.name}' is offline. Showing cached data.`,
      );
    }

    // Brief switching state to trigger loading skeletons in consumers
    setTimeout(() => {
      setIsSwitching(false);
    }, 150);
  }, []);

  // Clear toast after display
  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  return (
    <ProfileContext.Provider
      value={{
        profiles,
        activeProfile,
        profileId: activeProfile?.id ?? "default",
        setActiveProfile,
        isLoadingProfiles,
        profilesError,
        isSwitching,
      }}
    >
      {children}
      {toastMessage && <ProfileToast message={toastMessage} />}
    </ProfileContext.Provider>
  );
}

function ProfileToast({ message }: { message: string }) {
  return (
    <div className="fixed bottom-4 right-4 z-50 animate-in slide-in-from-bottom-4 fade-in duration-300">
      <div className="rounded-lg border bg-card px-4 py-3 shadow-lg">
        <p className="text-sm text-foreground">{message}</p>
      </div>
    </div>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useProfile() {
  const context = useContext(ProfileContext);
  if (context === undefined) {
    throw new Error("useProfile must be used within a ProfileProvider");
  }
  return context;
}
