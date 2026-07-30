/** @vitest-environment happy-dom */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  flushVaultFileSavedNotificationsForTests,
  notifyVaultFileSaved,
  setVaultFileSavedHandler,
} from "./linkIndexEvents";

describe("notifyVaultFileSaved", () => {
  afterEach(() => {
    setVaultFileSavedHandler(null);
    flushVaultFileSavedNotificationsForTests();
    vi.unstubAllGlobals();
  });

  it("defers handler work to idle and coalesces by path", () => {
    const idleCallbacks: Array<() => void> = [];
    vi.stubGlobal(
      "requestIdleCallback",
      (cb: IdleRequestCallback, _opts?: IdleRequestOptions) => {
        idleCallbacks.push(() =>
          cb({ didTimeout: false, timeRemaining: () => 10 }),
        );
        return idleCallbacks.length;
      },
    );
    vi.stubGlobal("cancelIdleCallback", vi.fn());

    const handler = vi.fn();
    setVaultFileSavedHandler(handler);

    notifyVaultFileSaved("/a.md", "one");
    notifyVaultFileSaved("/a.md", "two");
    notifyVaultFileSaved("/b.md", "bee");

    expect(handler).not.toHaveBeenCalled();
    expect(idleCallbacks).toHaveLength(1);

    idleCallbacks[0]();

    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenCalledWith("/a.md", "two");
    expect(handler).toHaveBeenCalledWith("/b.md", "bee");
  });
});
