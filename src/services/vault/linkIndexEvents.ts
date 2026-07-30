import { scheduleIdleWork } from "../../utils/performance";

type FileSavedHandler = (path: string, content: string) => void;
type RebuildHandler = () => Promise<void>;

let fileSavedHandler: FileSavedHandler | null = null;
let rebuildHandler: RebuildHandler | null = null;

/** Coalesce rapid saves so vault reindex/embed work runs once per idle turn. */
const pendingSavedFiles = new Map<string, string>();
let cancelScheduledFlush: (() => void) | null = null;

function flushPendingSavedFiles(): void {
  cancelScheduledFlush = null;
  if (!fileSavedHandler || pendingSavedFiles.size === 0) {
    pendingSavedFiles.clear();
    return;
  }

  const batch = Array.from(pendingSavedFiles.entries());
  pendingSavedFiles.clear();
  for (const [path, content] of batch) {
    try {
      fileSavedHandler(path, content);
    } catch (error) {
      console.warn("Vault file-saved handler failed:", error);
    }
  }
}

export function setVaultFileSavedHandler(
  handler: FileSavedHandler | null,
): void {
  fileSavedHandler = handler;
  if (!handler) {
    cancelScheduledFlush?.();
    cancelScheduledFlush = null;
    pendingSavedFiles.clear();
  }
}

/**
 * Notify that a vault markdown file was saved.
 * Work is deferred to idle time and coalesced by path so Cmd/S / autosave
 * do not block the UI on link-index rebuild + semantic embed.
 */
export function notifyVaultFileSaved(path: string, content: string): void {
  pendingSavedFiles.set(path, content);
  if (cancelScheduledFlush) {
    return;
  }
  cancelScheduledFlush = scheduleIdleWork(flushPendingSavedFiles, 600);
}

/** Test helper: run any coalesced save notifications immediately. */
export function flushVaultFileSavedNotificationsForTests(): void {
  cancelScheduledFlush?.();
  flushPendingSavedFiles();
}

export function setVaultRebuildHandler(handler: RebuildHandler | null): void {
  rebuildHandler = handler;
}

export async function requestVaultLinkIndexRebuild(): Promise<void> {
  if (!rebuildHandler) {
    throw new Error("Link index rebuild is not available yet.");
  }
  await rebuildHandler();
}
