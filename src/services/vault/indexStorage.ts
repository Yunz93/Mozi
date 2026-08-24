import { isTauriEnvironment } from "../../types/filesystem";

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

export type AppDataNamespace = "vault-index" | "ask-history";

/** Stable short id for a vault root path. */
export async function hashVaultId(vaultRoot: string): Promise<string> {
  const normalized = normalizePath(vaultRoot).toLowerCase();
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const data = new TextEncoder().encode(normalized);
    const digest = await crypto.subtle.digest("SHA-256", data);
    const bytes = Array.from(new Uint8Array(digest));
    return bytes
      .slice(0, 12)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  // Fallback for non-crypto environments / tests
  let hash = 0;
  for (let i = 0; i < normalized.length; i += 1) {
    hash = (hash * 31 + normalized.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Vault notes are added to the Tauri fs scope when a knowledge base opens.
 * App-data files (indexes, 小知助手 history) live under `appDataDir()` and
 * were never registered, so plugin-fs writes silently failed.
 */
let appDataScopePromise: Promise<void> | null = null;

async function ensureAppDataScope(): Promise<void> {
  if (!isTauriEnvironment()) return;
  if (!appDataScopePromise) {
    appDataScopePromise = (async () => {
      const { appDataDir } = await import("@tauri-apps/api/path");
      const { invoke } = await import("@tauri-apps/api/core");
      const root = await appDataDir();
      await invoke("register_allowed_path", { path: root, recursive: true });
    })().catch((error) => {
      appDataScopePromise = null;
      throw error;
    });
  }
  await appDataScopePromise;
}

async function resolveDataDir(
  vaultRoot: string,
  namespace: AppDataNamespace,
): Promise<string | null> {
  if (!isTauriEnvironment()) return null;
  try {
    await ensureAppDataScope();
    const { appDataDir, join } = await import("@tauri-apps/api/path");
    const vaultId = await hashVaultId(vaultRoot);
    const root = await appDataDir();
    return join(root, "MarkdownPress", namespace, vaultId);
  } catch {
    return null;
  }
}

const memoryStore = new Map<string, string>();

function memoryKey(
  vaultRoot: string,
  fileName: string,
  namespace: AppDataNamespace,
): string {
  return `${normalizePath(vaultRoot)}::${namespace}::${fileName}`;
}

function readMemoryJson<T>(
  vaultRoot: string,
  fileName: string,
  namespace: AppDataNamespace,
): T | null {
  const raw = memoryStore.get(memoryKey(vaultRoot, fileName, namespace));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function readIndexJson<T>(
  vaultRoot: string,
  fileName: string,
  namespace: AppDataNamespace = "vault-index",
): Promise<T | null> {
  const dir = await resolveDataDir(vaultRoot, namespace);
  if (!dir) {
    return readMemoryJson<T>(vaultRoot, fileName, namespace);
  }

  try {
    const { readTextFile, exists } = await import("@tauri-apps/plugin-fs");
    const { join } = await import("@tauri-apps/api/path");
    const filePath = await join(dir, fileName);
    if (!(await exists(filePath))) {
      return readMemoryJson<T>(vaultRoot, fileName, namespace);
    }
    const raw = await readTextFile(filePath);
    return JSON.parse(raw) as T;
  } catch {
    return readMemoryJson<T>(vaultRoot, fileName, namespace);
  }
}

export async function writeIndexJson(
  vaultRoot: string,
  fileName: string,
  value: unknown,
  namespace: AppDataNamespace = "vault-index",
): Promise<void> {
  const payload = JSON.stringify(value);
  memoryStore.set(memoryKey(vaultRoot, fileName, namespace), payload);
  const dir = await resolveDataDir(vaultRoot, namespace);
  if (!dir) return;

  try {
    const { writeTextFile, mkdir, rename, remove } =
      await import("@tauri-apps/plugin-fs");
    const { join } = await import("@tauri-apps/api/path");
    await mkdir(dir, { recursive: true });
    const target = await join(dir, fileName);
    const tmp = await join(
      dir,
      `${fileName}.${Date.now()}.${Math.random().toString(36).slice(2, 10)}.tmp`,
    );
    await writeTextFile(tmp, payload);
    try {
      await rename(tmp, target);
    } catch {
      await writeTextFile(target, payload);
      try {
        await remove(tmp);
      } catch {
        // ignore tmp cleanup failures
      }
    }
  } catch (error) {
    console.warn("Failed to persist vault index:", error);
  }
}

export async function clearIndexStorage(vaultRoot: string): Promise<void> {
  const prefix = `${normalizePath(vaultRoot)}::vault-index::`;
  for (const key of [...memoryStore.keys()]) {
    if (key.startsWith(prefix)) {
      memoryStore.delete(key);
    }
  }

  const dir = await resolveDataDir(vaultRoot, "vault-index");
  if (!dir) return;
  try {
    const { remove } = await import("@tauri-apps/plugin-fs");
    await remove(dir, { recursive: true });
  } catch {
    // ignore
  }
}

export const LINK_INDEX_FILE = "link-index.json";
export const CHUNK_INDEX_FILE = "chunk-index.json";
export const VECTOR_INDEX_FILE = "vector-index.json";
export const ASK_HISTORY_FILE = "ask-history.json";
