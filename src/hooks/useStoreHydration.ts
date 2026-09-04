import { useState, useEffect } from "react";
import { didAppStoreHydrationFail, useAppStore } from "../store/appStore";

interface PersistAPI {
  hasHydrated: () => boolean;
  onFinishHydration: (fn: () => void) => () => void;
}

function getPersistAPI(): PersistAPI | null {
  return (useAppStore as unknown as { persist?: PersistAPI }).persist ?? null;
}

/**
 * Tracks whether the zustand persist store has finished hydrating from localStorage.
 * Replaces the raw `(useAppStore as any).persist` pattern in App.tsx.
 */
export function useStoreHydration(): boolean {
  const [hydrated, setHydrated] = useState(() => {
    if (didAppStoreHydrationFail()) return true;
    const api = getPersistAPI();
    return api ? api.hasHydrated() : true;
  });

  useEffect(() => {
    if (didAppStoreHydrationFail()) {
      setHydrated(true);
      return;
    }

    const api = getPersistAPI();
    if (!api) return;

    setHydrated(api.hasHydrated() || didAppStoreHydrationFail());
    const unsubscribe = api.onFinishHydration(() => setHydrated(true));
    return () => unsubscribe?.();
  }, []);

  return hydrated;
}
