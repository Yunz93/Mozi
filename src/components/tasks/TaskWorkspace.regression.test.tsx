// @vitest-environment happy-dom
import React, { useRef } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TaskCalendarSnapshot } from "../../types/taskCalendar";
import { useTaskCalendarStore } from "../../store/taskCalendarStore";
import { TaskWorkspace } from "./TaskWorkspace";

const native = vi.hoisted(() => ({
  language: "zh-CN",
  writes: 0,
  getSnapshot: vi.fn(),
  savePreferences: vi.fn(),
  saveLanguage: vi.fn(),
}));
vi.mock("../../hooks/useI18n", () => ({
  useI18n: () => ({
    language: useRef(native.language).current,
    t: (key: string) => key,
  }),
}));
vi.mock("../../types/filesystem", async (original) => ({
  ...(await original<typeof import("../../types/filesystem")>()),
  isTauriEnvironment: () => true,
}));
vi.mock("../../services/taskCalendarService", () => ({
  getTaskCalendarSnapshot: native.getSnapshot,
  saveTaskCalendarPreferences: native.savePreferences,
  saveTaskCalendarLanguage: native.saveLanguage,
  registerTaskCalendarVault: vi.fn(),
  unregisterTaskCalendarVault: vi.fn(),
  refreshTaskCalendar: vi.fn(),
  sendTaskCalendarTestNotification: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  native.language = "zh-CN";
  native.writes = 0;
  useTaskCalendarStore.setState({
    loading: false,
    error: null,
    snapshot: {
      version: 1,
      tasks: [],
      vaults: [],
      excludedVaults: [],
      scanning: false,
      lastSyncedAt: null,
      error: null,
      calendarError: null,
      calendarSyncedAt: null,
      preferences: {
        language: "zh-CN",
        notifications: false,
        background: false,
        macCalendar: false,
        calendarId: "",
      },
    },
  });
  native.getSnapshot.mockImplementation(
    async () => useTaskCalendarStore.getState().snapshot,
  );
  const update = async (language: string) => {
    // 限制旧实现的往返次数，避免失败用例产生无限渲染。
    if (++native.writes > 8) throw new Error("language feedback loop");
    const snapshot = useTaskCalendarStore.getState().snapshot!;
    if (snapshot.preferences.language !== language) {
      useTaskCalendarStore.setState({
        snapshot: {
          ...snapshot,
          version: snapshot.version + 1,
          preferences: { ...snapshot.preferences, language },
        },
      });
    }
  };
  native.savePreferences.mockImplementation(async (preferences) =>
    update(preferences.language),
  );
  native.saveLanguage.mockImplementation(update);
});
afterEach(cleanup);

it("中文输入法的 229 Escape 只取消组词，不关闭浮层或抢回编辑焦点", async () => {
  const onClose = vi.fn();
  await act(async () => {
    render(
      <TaskWorkspace
        rootPath={null}
        trashFolder=".trash"
        hasUnsavedChanges={false}
        onOpenTask={vi.fn()}
        onClose={onClose}
      />,
    );
  });
  const composingEscape = new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    isComposing: false,
  });
  Object.defineProperty(composingEscape, "keyCode", { value: 229 });
  act(() => {
    document.dispatchEvent(composingEscape);
  });
  expect(onClose).not.toHaveBeenCalled();
  act(() => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
  expect(onClose).toHaveBeenCalledOnce();
});

it("不同语言窗口接收同一份日程快照时不会反复写回语言或覆盖提醒开关", async () => {
  const props = {
    rootPath: null,
    trashFolder: ".trash",
    hasUnsavedChanges: false,
    onOpenTask: vi.fn(),
    onClose: vi.fn(),
  };
  await act(async () => {
    render(<TaskWorkspace {...props} />);
  });
  await act(async () => {
    native.language = "en";
    render(<TaskWorkspace {...props} />);
  });
  for (let index = 0; index < 8; index++)
    await act(async () => {
      await Promise.resolve();
    });
  expect(native.writes).toBeLessThanOrEqual(2);
  expect(native.savePreferences).not.toHaveBeenCalled();
  const writes = native.writes;
  await act(async () => {
    const snapshot = useTaskCalendarStore.getState()
      .snapshot as TaskCalendarSnapshot;
    useTaskCalendarStore.setState({
      snapshot: {
        ...snapshot,
        version: snapshot.version + 1,
        preferences: { ...snapshot.preferences, notifications: true },
      },
    });
  });
  expect(native.writes).toBe(writes);
  expect(
    useTaskCalendarStore.getState().snapshot?.preferences.notifications,
  ).toBe(true);
});
