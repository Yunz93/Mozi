// @vitest-environment happy-dom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { defaultSettings, useAppStore } from "./appStore";
import {
  createAppStorePersistStorage,
  setAppStorePersistWritesEnabled,
} from "./persistStorage";
import { useSettings } from "../hooks/useSettings";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("does not write settings or rerender settings consumers for document/progress updates", () => {
  setAppStorePersistWritesEnabled(true);
  useAppStore.getState().updateSettings({ fontSize: 17 });
  const writes = vi.spyOn(localStorage, "setItem");
  let renders = 0;
  function Probe() {
    useSettings();
    renders++;
    return null;
  }
  render(<Probe />);
  const before = renders;
  act(() => {
    useAppStore.getState().addTab("/vault/note.md", "initial");
    for (let i = 0; i < 20; i++) {
      useAppStore.getState().setContent(`edit ${i}`);
      useAppStore
        .getState()
        .setLinkIndexProgress({
          phase: "building",
          done: i,
          total: 20,
          currentPath: null,
          error: null,
        });
    }
  });
  expect(writes).not.toHaveBeenCalled();
  expect(renders).toBe(before);
  act(() => useAppStore.getState().updateSettings({ fontSize: 18 }));
  expect(writes).toHaveBeenCalledTimes(1);
  expect(renders).toBe(before + 1);
  useAppStore.getState().setSettings(defaultSettings);
});

it("does not cache failed writes and invalidates deduplication on removal", () => {
  setAppStorePersistWritesEnabled(true);
  const storage = createAppStorePersistStorage<{ value: number }>()!;
  const value = { state: { value: 1 }, version: 1 };
  const spy = vi
    .spyOn(localStorage, "setItem")
    .mockImplementationOnce(() => {
      throw new Error("quota");
    });
  expect(() => storage.setItem("dedup-test", value)).toThrow("quota");
  storage.setItem("dedup-test", value);
  expect(spy).toHaveBeenCalledTimes(2);
  storage.setItem("dedup-test", value);
  storage.setItem("dedup-test", { state: { value: 1 }, version: 1 });
  expect(spy).toHaveBeenCalledTimes(2);
  storage.removeItem("dedup-test");
  storage.setItem("dedup-test", value);
  expect(spy).toHaveBeenCalledTimes(3);
  storage.removeItem("dedup-test");
});
