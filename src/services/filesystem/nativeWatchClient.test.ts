import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
const bridge = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  unlisten: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: bridge.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: bridge.listen }));
import { mapWatchPath, startNativeWatch } from "./nativeWatchClient";
const token = {
  subscriptionId: "s",
  epoch: "e",
  seq: 0,
  path: "/private/root",
};
const page = (seq: number, extra = {}) => ({
  epoch: "e",
  seq,
  changes: [],
  rescanRequired: false,
  ...extra,
});
const flush = async () => {
  for (let i = 0; i < 25; i++) await Promise.resolve();
};
let hint: (event: { payload: { subscriptionId: string } }) => void;
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  bridge.listen.mockImplementation(async (_name, handler) => {
    hint = handler;
    return bridge.unlisten;
  });
  bridge.invoke.mockImplementation(async (name) =>
    name === "subscribe_vault" ? token : page(0),
  );
});
afterEach(() => vi.useRealTimers());
function options() {
  return {
    path: "/root",
    directory: true,
    snapshot: vi.fn(async () => {}),
    batch: vi.fn(async () => {}),
    fallback: vi.fn(async () => vi.fn()),
  };
}
describe("native replay client", () => {
  it("maps macOS aliases, Windows verbatim and UNC paths without changing case", () => {
    expect(mapWatchPath("/private/root/A.md", "/private/root", "/root")).toBe(
      "/root/A.md",
    );
    expect(
      mapWatchPath("\\\\?\\C:\\Vault\\A.md", "\\\\?\\C:\\Vault", "C:\\Vault"),
    ).toBe("C:\\Vault\\A.md");
    expect(
      mapWatchPath(
        "\\\\?\\UNC\\server\\share\\A.md",
        "\\\\?\\UNC\\server\\share",
        "\\\\server\\share",
      ),
    ).toBe("\\\\server\\share\\A.md");
    expect(() =>
      mapWatchPath("/root-other/private", "/root", "/root"),
    ).toThrow();
  });
  it("subscribes before snapshot and replays changes made during it", async () => {
    const o = options();
    const order: string[] = [];
    bridge.invoke.mockImplementation(async (name, args) => {
      order.push(name);
      if (name === "subscribe_vault") return { ...token };
      return args.afterSeq === 0
        ? page(1, {
            changes: [
              {
                kind: "modified",
                path: "/private/root/a.md",
                isDirectory: false,
              },
            ],
          })
        : page(1);
    });
    o.snapshot.mockImplementation(async () => {
      order.push("snapshot");
    });
    const stop = startNativeWatch(o);
    await flush();
    expect(order.slice(0, 3)).toEqual([
      "subscribe_vault",
      "snapshot",
      "get_vault_changes",
    ]);
    expect(o.batch).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ path: "/root/a.md" })]),
      expect.anything(),
    );
    stop();
    expect(bridge.unlisten).toHaveBeenCalledOnce();
  });
  it("anchors a gap snapshot before its read, then drains again", async () => {
    const o = options();
    let calls = 0;
    bridge.invoke.mockImplementation(async (name) => {
      if (name === "subscribe_vault") return { ...token };
      if (name === "get_vault_changes")
        return ++calls === 1 ? page(5, { rescanRequired: true }) : page(5);
    });
    const stop = startNativeWatch(o);
    await flush();
    expect(o.snapshot).toHaveBeenCalledTimes(2);
    expect(bridge.invoke).toHaveBeenCalledWith(
      "get_vault_changes",
      expect.objectContaining({ afterSeq: 5 }),
    );
    stop();
  });
  it("unsubscribes a late registration after disposal without delivering a snapshot", async () => {
    const o = options();
    let resolve!: (value: typeof token) => void;
    bridge.invoke.mockImplementation((name) =>
      name === "subscribe_vault"
        ? new Promise((r) => {
            resolve = r;
          })
        : Promise.resolve(),
    );
    const stop = startNativeWatch(o);
    await flush();
    stop();
    resolve({ ...token });
    await flush();
    expect(o.snapshot).not.toHaveBeenCalled();
    expect(bridge.invoke).toHaveBeenCalledWith("unsubscribe_vault", {
      subscriptionId: "s",
    });
  });
  it("falls back once on backend loss and stops replay before polling", async () => {
    const o = options();
    const stopPoll = vi.fn();
    o.fallback.mockResolvedValue(stopPoll);
    bridge.invoke.mockImplementation(async (name) =>
      name === "subscribe_vault"
        ? { ...token }
        : page(1, { error: "root lost" }),
    );
    const stop = startNativeWatch(o);
    await flush();
    hint({ payload: { subscriptionId: "s" } });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(o.fallback).toHaveBeenCalledOnce();
    expect(
      bridge.invoke.mock.calls.filter(([name]) => name === "get_vault_changes"),
    ).toHaveLength(1);
    stop();
    expect(stopPoll).toHaveBeenCalledOnce();
  });
  it("recovers a dropped hint using only the journal heartbeat", async () => {
    const o = options();
    const stop = startNativeWatch(o);
    await flush();
    const reads = bridge.invoke.mock.calls.length;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(bridge.invoke.mock.calls.length).toBe(reads + 1);
    expect(o.snapshot).toHaveBeenCalledOnce();
    stop();
  });
});
