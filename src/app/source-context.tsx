/**
 * SourceContext — global source filter, replacing the old profile system.
 *
 * There is no more multi-tenant "profile" concept. Sources (claude-code,
 * codex, hermes, lemonade, comfyui) are a fixed registry the backend seeds
 * on boot (GET /api/sources) — this context just tracks which one the user
 * has selected to filter list pages by, defaulting to "all".
 */

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useSources, type Source } from "@/lib/queries";

const STORAGE_KEY = "mc-selected-source";

interface SourceContextType {
  sources: Source[];
  isLoading: boolean;
  error: string | null;
  /** undefined means "all sources" */
  selectedSourceId: string | undefined;
  setSelectedSourceId: (sourceId: string | undefined) => void;
}

const SourceContext = createContext<SourceContextType | undefined>(undefined);

export function SourceProvider({ children }: { children: ReactNode }) {
  const { data: sources, isLoading, error } = useSources();
  const [selectedSourceId, setSelectedSourceIdState] = useState<
    string | undefined
  >(() => {
    if (typeof window === "undefined") return undefined;
    return localStorage.getItem(STORAGE_KEY) || undefined;
  });

  const setSelectedSourceId = (sourceId: string | undefined) => {
    setSelectedSourceIdState(sourceId);
    if (typeof window !== "undefined") {
      if (sourceId) localStorage.setItem(STORAGE_KEY, sourceId);
      else localStorage.removeItem(STORAGE_KEY);
    }
  };

  // If the stored source no longer exists in the registry, treat it as "all"
  // — derived, not synced via effect (avoids a cascading extra render).
  const effectiveSourceId = useMemo(() => {
    if (!selectedSourceId || !sources) return selectedSourceId;
    return sources.some((s) => s.id === selectedSourceId)
      ? selectedSourceId
      : undefined;
  }, [sources, selectedSourceId]);

  return (
    <SourceContext.Provider
      value={{
        sources: sources ?? [],
        isLoading,
        error: error instanceof Error ? error.message : null,
        selectedSourceId: effectiveSourceId,
        setSelectedSourceId,
      }}
    >
      {children}
    </SourceContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSourceFilter() {
  const context = useContext(SourceContext);
  if (context === undefined) {
    throw new Error("useSourceFilter must be used within a SourceProvider");
  }
  return context;
}
