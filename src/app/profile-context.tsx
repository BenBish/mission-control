import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Profile } from "@/types/profile";
import { useProfiles } from "@/hooks/useProfiles";

const STORAGE_KEY = "openclaw-active-profile";

interface ProfileContextType {
  profiles: Profile[];
  activeProfile: Profile | null;
  setActiveProfile: (profile: Profile) => void;
  isLoadingProfiles: boolean;
  isSwitching: boolean;
}

const ProfileContext = createContext<ProfileContextType | undefined>(undefined);

interface ProfileProviderProps {
  children: ReactNode;
}

export function ProfileProvider({ children }: ProfileProviderProps) {
  const { profiles, isLoading: isLoadingProfiles } = useProfiles();
  const [activeProfile, setActiveProfileState] = useState<Profile | null>(null);
  const [isSwitching, setIsSwitching] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Initialize active profile from localStorage or first profile
  useEffect(() => {
    if (profiles.length === 0) return;

    const storedId =
      typeof window !== "undefined"
        ? localStorage.getItem(STORAGE_KEY)
        : null;

    const stored = storedId
      ? profiles.find((p) => p.id === storedId)
      : null;

    if (stored) {
      setActiveProfileState(stored);
    } else {
      setActiveProfileState(profiles[0]);
      if (typeof window !== "undefined") {
        localStorage.setItem(STORAGE_KEY, profiles[0].id);
      }
    }
  }, [profiles]);

  // Update active profile when profiles refresh (status might change)
  useEffect(() => {
    if (!activeProfile || profiles.length === 0) return;
    const updated = profiles.find((p) => p.id === activeProfile.id);
    if (updated && updated.status !== activeProfile.status) {
      setActiveProfileState(updated);
    }
  }, [profiles, activeProfile]);

  const setActiveProfile = useCallback(
    (profile: Profile) => {
      setIsSwitching(true);
      setActiveProfileState(profile);

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
    },
    [],
  );

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
        setActiveProfile,
        isLoadingProfiles,
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
