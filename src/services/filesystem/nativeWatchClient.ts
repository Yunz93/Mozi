import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface NativeChange {
  kind: "created" | "modified" | "removed" | "renamed";
  path: string;
  oldPath?: string;
  isDirectory: boolean;
}
interface Token {
  subscriptionId: string;
  path: string;
  epoch: string;
  seq: number;
}
interface Page {
  epoch: string;
  seq: number;
  changes: NativeChange[];
  rescanRequired: boolean;
  error?: string | null;
}
export const watchPath = (path: string): string =>
  path.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
export const withinWatchPath = (path: string, root: string): boolean => {
  const p = watchPath(path);
  const r = watchPath(root);
  return p === r || p.startsWith(r === "/" ? r : `${r}/`);
};

/** Map canonical IPC paths back to the spelling used by document IDs. */
export function mapWatchPath(
  path: string,
  canonical: string,
  original: string,
): string {
  const p = watchPath(path);
  const root = watchPath(canonical);
  if (!withinWatchPath(p, root))
    throw new Error("Watch event escaped its scope");
  const suffix = p.slice(root === "/" ? 0 : root.length).replace(/^\/+/, "");
  const separator = original.includes("\\") ? "\\" : "/";
  return suffix
    ? `${original.replace(/[\\/]+$/, "")}${separator}${suffix.replace(/\//g, separator)}`
    : original;
}

export async function nativeWatchEnabled(): Promise<boolean> {
  try {
    return (await invoke("vault_watch_mode")) === "native";
  } catch {
    return false;
  }
}
interface Context {
  active: () => boolean;
}
interface Options {
  path: string;
  directory: boolean;
  snapshot: (context: Context) => Promise<boolean | void>;
  batch: (changes: NativeChange[], context: Context) => Promise<boolean | void>;
  fallback: () => Promise<() => void>;
}

/** A single serialized replay loop. Hints are optional; the heartbeat reads only
 * the bounded journal, never the filesystem. Subscribe BEFORE taking a snapshot.
 */
export function startNativeWatch(options: Options): () => void {
  let disposed = false;
  let native = true;
  let ready = false;
  let running = false;
  let requested = false;
  let token: Token | undefined;
  let unlisten: (() => void) | undefined;
  let stopPolling: (() => void) | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  const context = { active: () => !disposed && native };
  const release = (id: string) => {
    void invoke("unsubscribe_vault", { subscriptionId: id }).catch(() => {});
  };
  const stopNative = () => {
    native = false;
    ready = false;
    unlisten?.();
    unlisten = undefined;
    if (timer !== undefined) clearInterval(timer);
    if (token) release(token.subscriptionId);
    token = undefined;
  };
  const close = () => {
    disposed = true;
    stopNative();
    stopPolling?.();
  };
  const fallback = async () => {
    if (!context.active()) return;
    stopNative();
    try {
      const stop = await options.fallback();
      if (disposed) stop();
      else stopPolling = stop;
    } catch (error) {
      console.warn("Failed to start filesystem watch fallback:", error);
    }
  };
  const drain = async () => {
    if (!ready || running || !context.active()) return;
    running = true;
    let gaps = 0;
    try {
      while (requested && context.active() && token) {
        requested = false;
        const cursor = token.seq;
        const page = await invoke<Page>("get_vault_changes", {
          subscriptionId: token.subscriptionId,
          epoch: token.epoch,
          afterSeq: cursor,
        });
        if (!context.active()) break;
        if (page.error) throw new Error(page.error);
        if (!Number.isSafeInteger(page.seq) || page.seq < cursor)
          throw new Error("Invalid watch cursor");
        token.epoch = page.epoch;
        token.seq = page.seq;
        if (page.rescanRequired) {
          if (++gaps > 3)
            throw new Error("Watch journal repeatedly overflowed");
          // Anchor the snapshot at the cursor BEFORE the disk read. Changes that
          // happen during that read will be replayed on the next iteration.
          if ((await options.snapshot(context)) === false) {
            close();
            break;
          }
          requested = true;
        } else {
          const changes = page.changes.map((change) => ({
            ...change,
            path: mapWatchPath(change.path, token!.path, options.path),
            oldPath: change.oldPath
              ? mapWatchPath(change.oldPath, token!.path, options.path)
              : undefined,
          }));
          if (
            changes.length &&
            (await options.batch(changes, context)) === false
          ) {
            close();
            break;
          }
          if (page.seq > cursor) requested = true;
        }
      }
    } catch {
      await fallback();
    } finally {
      running = false;
    }
  };
  const request = () => {
    requested = true;
    void drain();
  };
  void (async () => {
    try {
      const stop = await listen<{ subscriptionId: string }>(
        "vault-watch-changed",
        ({ payload }) => {
          if (payload.subscriptionId === token?.subscriptionId) request();
        },
      );
      if (!context.active()) {
        stop();
        return;
      }
      unlisten = stop;
      const result = await invoke<Token>("subscribe_vault", {
        path: options.path,
        directory: options.directory,
      });
      if (!context.active()) {
        release(result.subscriptionId);
        return;
      }
      token = result;
      if ((await options.snapshot(context)) === false) {
        close();
        return;
      }
      if (!context.active()) return;
      ready = true;
      timer = setInterval(request, 15_000);
      request();
    } catch {
      await fallback();
    }
  })();
  return close;
}
