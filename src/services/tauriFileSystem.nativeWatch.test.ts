import { beforeEach, afterEach, it, expect, vi } from "vitest";
const bridge = vi.hoisted(() => ({
  invoke: vi.fn(),
  read: vi.fn(),
  readDir: vi.fn(),
  unlisten: vi.fn(),
  listen: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  readFile: bridge.read,
  readDir: bridge.readDir,
  writeTextFile: vi.fn(),
  writeFile: vi.fn(),
  exists: vi.fn(),
  mkdir: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@tauri-apps/api/path", () => ({
  sep: () => "/",
  basename: async (p: string) => p.split("/").pop(),
  dirname: async (p: string) => p.split("/").slice(0, -1).join("/"),
  join: async (...p: string[]) => p.join("/"),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: bridge.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: bridge.listen }));
vi.mock("../store/appStore", () => ({
  useAppStore: {
    getState: () => ({
      rootFolderPath: "/v",
      settings: { trashFolder: ".trash" },
    }),
  },
}));
import { TauriFileSystem } from "./tauriFileSystem";
import type { NativeChange } from "./filesystem/nativeWatchClient";
let hint: (event: { payload: { subscriptionId: string } }) => void;
let seq = 0;
let changes: NativeChange[] = [];
const flush = async () => {
  for (let i = 0; i < 70; i++) await Promise.resolve();
};
const entry = (name: string, isDirectory = false, isSymlink = false) => ({
  name,
  isDirectory,
  isFile: !isDirectory,
  isSymlink,
});
const modify = (path: string): NativeChange => ({
  kind: "modified",
  path,
  isDirectory: false,
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", globalThis);
  vi.clearAllMocks();
  seq = 0;
  changes = [];
  bridge.listen.mockImplementation(async (_event, handler) => {
    hint = handler;
    return bridge.unlisten;
  });
  bridge.invoke.mockImplementation(async (name) => {
    if (name === "vault_watch_mode") return "native";
    if (name === "subscribe_vault")
      return { subscriptionId: "s", epoch: "e", seq, path: "/v" };
    if (name === "get_vault_changes") {
      const batch = changes;
      changes = [];
      return { epoch: "e", seq, changes: batch, rescanRequired: false };
    }
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function emit(batch: NativeChange[]) {
  changes = batch;
  seq++;
  hint({ payload: { subscriptionId: "s" } });
  await flush();
}
it("reads only an externally edited file and suppresses its own saves", async () => {
  const fs = new TauriFileSystem();
  const callback = vi.fn();
  bridge.read.mockResolvedValue(new TextEncoder().encode("before"));
  await fs.readFile("/v/a.md");
  const stop = await fs.watchFile("/v/a.md", callback);
  await flush();
  expect(bridge.invoke).toHaveBeenCalledWith("subscribe_vault", {
    path: "/v",
    directory: true,
  });
  await fs.writeFile("/v/a.md", "own save");
  bridge.read.mockResolvedValue(new TextEncoder().encode("own save"));
  await emit([modify("/v/a.md")]);
  expect(callback).not.toHaveBeenCalled();
  bridge.read.mockResolvedValue(new TextEncoder().encode("external"));
  await emit([modify("/v/a.md")]);
  expect(callback).toHaveBeenCalledWith({ type: "modified", path: "/v/a.md" });
  expect(bridge.readDir).not.toHaveBeenCalled();
  stop();
});
it("ignores stale content read before a concurrent save", async () => {
  const fs = new TauriFileSystem();
  const callback = vi.fn();
  bridge.read.mockResolvedValue(new TextEncoder().encode("before"));
  await fs.readFile("/v/a.md");
  let resolve!: (value: Uint8Array) => void;
  bridge.read.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const stop = await fs.watchFile("/v/a.md", callback);
  await flush();
  await fs.writeFile("/v/a.md", "saved during read");
  resolve(new TextEncoder().encode("stale"));
  await flush();
  expect(callback).not.toHaveBeenCalled();
  stop();
});
it.each(["native", "poll"])(
  "%s: an index read cannot acknowledge an external edit for the document watcher",
  async (mode) => {
    const original = bridge.invoke.getMockImplementation()!;
    bridge.invoke.mockImplementation((name, ...args) =>
      name === "vault_watch_mode"
        ? Promise.resolve(mode)
        : original(name, ...args),
    );
    const fs = new TauriFileSystem();
    const callback = vi.fn();
    bridge.read.mockResolvedValue(new TextEncoder().encode("before"));
    await fs.readFile("/v/a.md");
    const stop = await fs.watchFile("/v/a.md", callback);
    await flush();
    bridge.read.mockResolvedValue(new TextEncoder().encode("external"));
    await fs.readFile("/v/a.md"); // An index consumer wins the disk-read race.
    if (mode === "native") await emit([modify("/v/a.md")]);
    else await vi.advanceTimersByTimeAsync(1500);
    expect(callback).toHaveBeenCalledExactlyOnceWith({
      path: "/v/a.md",
      type: "modified",
    });
    stop();
  },
);
it("keeps delivering a change when another reader finishes during the watch read", async () => {
  const fs = new TauriFileSystem();
  const callback = vi.fn();
  bridge.read.mockResolvedValue(new TextEncoder().encode("before"));
  await fs.readFile("/v/a.md");
  const stop = await fs.watchFile("/v/a.md", callback);
  await flush();
  let resolve!: (value: Uint8Array) => void;
  bridge.read.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  changes = [modify("/v/a.md")];
  seq++;
  hint({ payload: { subscriptionId: "s" } });
  await flush();
  bridge.read.mockResolvedValue(new TextEncoder().encode("external"));
  await fs.readFile("/v/a.md");
  resolve(new TextEncoder().encode("external"));
  await flush();
  expect(callback).toHaveBeenCalledExactlyOnceWith({
    path: "/v/a.md",
    type: "modified",
  });
  stop();
});
it.each([false, true])(
  "reconciles the first polling snapshot after backend loss (initial read unavailable: %s)",
  async (unavailable) => {
    let failed = false;
    let failInitialRead = unavailable;
    const original = bridge.invoke.getMockImplementation()!;
    bridge.invoke.mockImplementation((name, ...args) => {
      if (name === "get_vault_changes" && failed)
        return Promise.reject(new Error("backend lost"));
      return original(name, ...args);
    });
    bridge.readDir.mockImplementation(async () => {
      if (!failed) return [];
      if (failInitialRead) {
        failInitialRead = false;
        throw new Error("No such file or directory");
      }
      return [entry("created-during-failure.md")];
    });
    const fs = new TauriFileSystem();
    const callback = vi.fn();
    const stop = await fs.watchDirectory("/v", callback);
    await flush();
    callback.mockClear();
    failed = true;
    await emit([]);
    if (unavailable) await vi.advanceTimersByTimeAsync(2000);
    expect(callback).toHaveBeenCalledWith({
      type: "changed",
      rescan: true,
      tree: [expect.objectContaining({ path: "/v/created-during-failure.md" })],
    });
    stop();
  },
);
it("refreshes a root listing without rescanning existing subtrees, preserving trash and symlink policy", async () => {
  const fs = new TauriFileSystem();
  const callback = vi.fn();
  let created = false;
  bridge.readDir.mockImplementation(async (path) => {
    if (path === "/v")
      return [
        entry("folder", true),
        entry(".private", true),
        entry(".trash", true),
        entry("link", true, true),
        ...(created ? [entry("new.md")] : []),
      ];
    if (path === "/v/folder") return [entry("existing.md")];
    if (path === "/v/.trash") return [entry(".hidden.md")];
    throw new Error(`unexpected scan ${path}`);
  });
  const stop = await fs.watchDirectory("/v", callback);
  await flush();
  const initial = callback.mock.calls[0][0].tree;
  expect(initial.map((node: { name: string }) => node.name)).toEqual([
    "folder",
    ".trash",
  ]);
  expect(initial[1].children[0].isTrash).toBe(true);
  bridge.readDir.mockClear();
  callback.mockClear();
  created = true;
  await emit([{ path: "/v/new.md", kind: "created", isDirectory: false }]);
  expect(bridge.readDir).toHaveBeenCalledExactlyOnceWith("/v");
  expect(callback.mock.calls[0][0].tree[0].children).toBe(initial[0].children);
  bridge.readDir.mockClear();
  await emit([modify("/v/.private/cache.json")]);
  expect(bridge.readDir).not.toHaveBeenCalled();
  stop();
});
it("emits deletion once and releases the registration", async () => {
  const fs = new TauriFileSystem();
  const callback = vi.fn();
  bridge.read.mockRejectedValue(new Error("No such file or directory"));
  const stop = await fs.watchFile("/v/a.md", callback);
  await flush();
  expect(callback).toHaveBeenCalledExactlyOnceWith({
    path: "/v/a.md",
    type: "deleted",
  });
  expect(bridge.invoke).toHaveBeenCalledWith("unsubscribe_vault", {
    subscriptionId: "s",
  });
  stop();
});
