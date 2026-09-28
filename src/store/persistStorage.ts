/**
 * Zustand persist storage that refuses to write until hydration finishes.
 *
 * Without this, a pre-hydrate `setState` (common after an app update when
 * more startup code runs) would snapshot default settings over the user's
 * saved `localStorage` blob.
 */

import { createJSONStorage, type PersistStorage } from "zustand/middleware";

export const APP_STORE_PERSIST_BACKUP_SUFFIX = ".bak";

let persistWritesEnabled = false;

export function setAppStorePersistWritesEnabled(enabled: boolean): void {
  persistWritesEnabled = enabled;
}

export function areAppStorePersistWritesEnabled(): boolean {
  return persistWritesEnabled;
}

export function backupLocalStorageKey(name: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    const raw = localStorage.getItem(name);
    if (!raw) return;
    localStorage.setItem(`${name}${APP_STORE_PERSIST_BACKUP_SUFFIX}`, raw);
  } catch {
    // localStorage 可能不可用或配额已满；宁可留下原值也不要删。
  }
}

export function createAppStorePersistStorage<T>():
  | PersistStorage<T>
  | undefined {
  const inner = createJSONStorage<T>(() => localStorage);
  if (!inner) return undefined;

  return {
    getItem: (name) => inner.getItem(name),
    setItem: (name, value) => {
      if (!persistWritesEnabled) return;
      return inner.setItem(name, value);
    },
    removeItem: (name) => inner.removeItem(name),
  };
}
