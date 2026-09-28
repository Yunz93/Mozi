/** @vitest-environment happy-dom */

import { afterEach, describe, expect, it } from "vitest";
import {
  areAppStorePersistWritesEnabled,
  backupLocalStorageKey,
  createAppStorePersistStorage,
  setAppStorePersistWritesEnabled,
} from "./persistStorage";

const KEY = "markdown-press-settings-test";

afterEach(() => {
  setAppStorePersistWritesEnabled(true);
  localStorage.removeItem(KEY);
  localStorage.removeItem(`${KEY}.bak`);
});

describe("createAppStorePersistStorage", () => {
  it("does not overwrite storage while persist writes are disabled", async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        state: {
          settings: { language: "en", lastKnowledgeBasePath: "/vault" },
        },
        version: 1,
      }),
    );
    setAppStorePersistWritesEnabled(false);
    const storage = createAppStorePersistStorage();
    expect(storage).toBeDefined();

    await storage!.setItem(KEY, {
      state: { settings: { language: "zh-CN" } },
      version: 1,
    });

    expect(
      JSON.parse(localStorage.getItem(KEY) ?? "{}").state.settings.language,
    ).toBe("en");
    expect(
      JSON.parse(localStorage.getItem(KEY) ?? "{}").state.settings
        .lastKnowledgeBasePath,
    ).toBe("/vault");
  });

  it("writes after persist is enabled", async () => {
    setAppStorePersistWritesEnabled(true);
    const storage = createAppStorePersistStorage();
    await storage!.setItem(KEY, {
      state: { settings: { language: "en" } },
      version: 1,
    });
    expect(
      JSON.parse(localStorage.getItem(KEY) ?? "{}").state.settings.language,
    ).toBe("en");
  });
});

describe("backupLocalStorageKey", () => {
  it("copies the current blob instead of deleting it", () => {
    localStorage.setItem(KEY, '{"state":');
    backupLocalStorageKey(KEY);
    expect(localStorage.getItem(KEY)).toBe('{"state":');
    expect(localStorage.getItem(`${KEY}.bak`)).toBe('{"state":');
  });
});

describe("areAppStorePersistWritesEnabled", () => {
  it("tracks the write gate", () => {
    setAppStorePersistWritesEnabled(false);
    expect(areAppStorePersistWritesEnabled()).toBe(false);
    setAppStorePersistWritesEnabled(true);
    expect(areAppStorePersistWritesEnabled()).toBe(true);
  });
});
