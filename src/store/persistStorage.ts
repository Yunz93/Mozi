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
  let backing: Storage;
  try {
    backing = localStorage;
  } catch {
    return undefined;
  }
  const serialized = new Map<string, string>();
  const written = new Map<string, { state: T; version?: number }>();
  const inner = createJSONStorage<T>(() => ({
    getItem: (name) => {
      written.delete(name);
      const raw = backing.getItem(name);
      if (raw !== null) serialized.set(name, raw);
      else serialized.delete(name);
      return raw;
    },
    setItem: (name, raw) => {
      if (serialized.get(name) === raw) return;
      // Do not cache failed writes: the next call must be able to retry.
      backing.setItem(name, raw);
      serialized.set(name, raw);
    },
    removeItem: (name) => {
      backing.removeItem(name);
      serialized.delete(name);
      written.delete(name);
    },
  }));
  if (!inner) return undefined;

  return {
    getItem: (name) => inner.getItem(name),
    setItem: (name, value) => {
      if (!persistWritesEnabled) return;
      const previous = written.get(name);
      if (previous?.state === value.state && previous.version === value.version)
        return;
      inner.setItem(name, value);
      written.set(name, value);
    },
    removeItem: (name) => inner.removeItem(name),
  };
}
