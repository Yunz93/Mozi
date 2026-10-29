/** @vitest-environment happy-dom */
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings, useAppStore } from "../store/appStore";
const mocks = vi.hoisted(() => ({ close: vi.fn(), unsafeClose: vi.fn() }));
vi.mock("../app/useCloseGuard", () => ({
  completeAppCloseAfterDiscard: mocks.close,
  completeAppClose: mocks.unsafeClose,
}));
vi.mock("./settings/SettingsModal", () => ({ SettingsModal: () => null }));
vi.mock("./ai/AiResultReviewDialog", () => ({
  AiResultReviewDialog: () => null,
}));
vi.mock("./publish/PublishTargetDialog", () => ({
  PublishTargetDialog: () => null,
}));
vi.mock("./publish/SimpleBlogPublishDialog", () => ({
  SimpleBlogPublishDialog: () => null,
}));
vi.mock("./publish/WechatDraftDialog", () => ({
  WechatDraftDialog: () => null,
}));
vi.mock("./import/WeReadImportDialog", () => ({
  WeReadImportDialog: () => null,
}));
vi.mock("./share/ShareLongImageDialog", () => ({
  ShareLongImageDialog: () => null,
}));
vi.mock("../services/vault/builtinEmbeddingConsent", () => ({
  registerBuiltinEmbeddingConsentPrompt: vi.fn(),
}));
vi.mock("../hooks/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) =>
      ({
        tab_closeSaveFailedTitle: "保存失败",
        tab_closeSaveFailedMessage: "备份草稿后关闭",
        tab_closeSaveFailedConfirm: "放弃并关闭",
        common_cancel: "取消",
      })[key] ?? key,
  }),
}));
import { AppDialogs } from "./AppDialogs";
function mount() {
  const props = {
    settings: defaultSettings,
    t: (key: string) => key,
    uiScaleStyle: {},
    notification: null,
  } as React.ComponentProps<typeof AppDialogs>;
  return render(<AppDialogs {...props} />);
}
beforeEach(() => {
  mocks.close.mockReset().mockResolvedValue(undefined);
  mocks.unsafeClose.mockReset().mockResolvedValue(undefined);
  useAppStore.setState({
    settings: defaultSettings,
    pendingCloseDespiteSaveFailure: "exit",
    pendingDraftRestore: null,
  });
});
afterEach(() => {
  cleanup();
  useAppStore.setState({ pendingCloseDespiteSaveFailure: null });
});
describe("application discard confirmation", () => {
  it("uses the all-window backup close path after explicit confirmation", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "放弃并关闭" }));
    await waitFor(() => expect(mocks.close).toHaveBeenCalledWith("exit"));
    expect(mocks.unsafeClose).not.toHaveBeenCalled();
  });
  it("restores the cancellable prompt when another window cannot back up", async () => {
    mocks.close.mockRejectedValueOnce(new Error("backup failed"));
    mount();
    fireEvent.click(screen.getByRole("button", { name: "放弃并关闭" }));
    await waitFor(() =>
      expect(useAppStore.getState().pendingCloseDespiteSaveFailure).toBe(
        "exit",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(useAppStore.getState().pendingCloseDespiteSaveFailure).toBeNull();
    expect(mocks.close).toHaveBeenCalledTimes(1);
    expect(mocks.unsafeClose).not.toHaveBeenCalled();
  });
  it("keeps the application open when the user cancels before confirming discard", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(useAppStore.getState().pendingCloseDespiteSaveFailure).toBeNull();
    expect(mocks.close).not.toHaveBeenCalled();
    expect(mocks.unsafeClose).not.toHaveBeenCalled();
  });
});
