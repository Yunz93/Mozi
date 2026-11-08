// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { useAppStore, defaultSettings } from "../../store/appStore";
import {
  captureDocumentSession,
  selectDocumentSession,
} from "./sessionSnapshot";
import {
  applyDocumentSessionEdit,
  openDocumentSession,
} from "./documentSession";

vi.mock("../../types/filesystem", () => ({
  getFileSystem: async () => ({ writeFile: async () => {} }),
}));
beforeEach(() => {
  useAppStore.setState({
    rootFolderPath: "/vault",
    currentFilePath: "/vault/a.md",
    activeTabId: "/vault/a.md",
    openTabs: ["/vault/a.md"],
    fileContents: { "/vault/a.md": "original" },
    lastSavedContent: { "/vault/a.md": "original" },
    fileHistories: {},
    settings: defaultSettings,
  });
});
it("keeps the session selector stable for unrelated UI work", () => {
  const session = selectDocumentSession(useAppStore.getState());
  useAppStore.getState().setSaving(true);
  expect(selectDocumentSession(useAppStore.getState())).toBe(session);
});
it("rejects staged edits after the original document is closed or its vault changes", () => {
  const source = captureDocumentSession(useAppStore.getState())!;
  useAppStore.getState().closeTab(source.documentId);
  expect(
    applyDocumentSessionEdit({
      fileId: source.documentId,
      content: "AI",
      source,
    }),
  ).toBe(false);
  expect(
    useAppStore.getState().fileContents[source.documentId],
  ).toBeUndefined();
  useAppStore.getState().addTab(source.documentId, "original");
  useAppStore.getState().setCurrentFilePath(source.path);
  useAppStore.getState().setRootFolderPath("/other");
  expect(
    applyDocumentSessionEdit({
      fileId: source.documentId,
      content: "AI",
      source,
    }),
  ).toBe(false);
});
it("rejects an old result even when edit/undo returns to the same text", () => {
  const source = captureDocumentSession(useAppStore.getState())!;
  useAppStore.getState().setContent("edited");
  useAppStore.getState().undo();
  expect(selectDocumentSession(useAppStore.getState())?.content).toBe(
    "original",
  );
  expect(
    applyDocumentSessionEdit({
      fileId: source.documentId,
      content: "AI",
      source,
    }),
  ).toBe(false);
});
it("does not apply an outstanding open after its vault has changed", async () => {
  let resolve!: (value: string) => void;
  const readFile = vi.fn(
    () =>
      new Promise<string>((done) => {
        resolve = done;
      }),
  );
  const opening = openDocumentSession(
    { id: "/vault/b.md", path: "/vault/b.md", name: "b.md", type: "file" },
    { readFile, language: "zh-CN", showNotification: vi.fn() },
  );
  await vi.waitFor(() => expect(readFile).toHaveBeenCalled());
  useAppStore.getState().setRootFolderPath("/other");
  resolve("stale read");
  await opening;
  expect(useAppStore.getState().fileContents["/vault/b.md"]).not.toBe(
    "stale read",
  );
});
