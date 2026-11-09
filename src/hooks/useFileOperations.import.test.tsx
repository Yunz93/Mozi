// @vitest-environment happy-dom
import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defaultSettings, useAppStore } from "../store/appStore";
import { useFileOperations } from "./useFileOperations";

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  refreshFileTree: vi.fn(),
  writeBlobFile: vi.fn(),
  notify: vi.fn(),
}));
vi.mock("./useFileSystem", () => ({
  useFileSystem: () => ({
    readFile: mocks.readFile,
    refreshFileTree: mocks.refreshFileTree,
  }),
}));
vi.mock("../types/filesystem", () => ({
  getFileSystem: async () => ({
    fileExists: async () => false,
    createDirectory: async () => {},
    writeBinaryFile: async () => {},
    writeFile: async () => {},
    writeBlobFile: mocks.writeBlobFile,
  }),
}));

const previous = {
  id: "/vault/previous.md",
  path: "/vault/previous.md",
  name: "previous.md",
  type: "file" as const,
};
let operations: ReturnType<typeof useFileOperations>;
function Harness() {
  operations = useFileOperations();
  return null;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.readFile.mockResolvedValue("# Imported");
  mocks.writeBlobFile.mockResolvedValue(undefined);
  useAppStore.setState({
    settings: { ...defaultSettings, language: "zh-CN" },
    rootFolderPath: "/vault",
    files: [previous],
    openTabs: [previous.id],
    activeTabId: previous.id,
    currentFilePath: previous.path,
    fileContents: { [previous.id]: "# Current" },
    lastSavedContent: { [previous.id]: "# Current" },
    showNotification: mocks.notify,
  });
});
afterEach(() => {
  cleanup();
  useAppStore.setState({
    rootFolderPath: null,
    files: [],
    openTabs: [],
    activeTabId: null,
    currentFilePath: null,
    fileContents: {},
    lastSavedContent: {},
  });
});

it.each([
  ["large.pdf", 16 * 1024 * 1024],
  ["presentation.ppt", 900_000_000],
  ["presentation.pptx", 900_000_000],
])(
  "imports %s without automatically opening it or stealing the current document",
  async (name, size) => {
    const file = new File(["fixture"], name);
    Object.defineProperty(file, "size", { value: size });
    const imported = {
      id: `/vault/${name}`,
      path: `/vault/${name}`,
      name,
      type: "file" as const,
    };
    mocks.refreshFileTree.mockImplementation(async () => {
      useAppStore.setState({ files: [previous, imported] });
    });
    render(<Harness />);
    await act(async () =>
      operations.handleImportDroppedFiles("/vault", [file]),
    );
    expect(mocks.refreshFileTree).toHaveBeenCalledOnce();
    expect(mocks.notify).toHaveBeenCalledWith(
      expect.stringContaining(name),
      "success",
    );
    expect(useAppStore.getState().activeTabId).toBe(previous.id);
    expect(useAppStore.getState().openTabs).toEqual([previous.id]);
    expect(mocks.readFile).not.toHaveBeenCalled();
  },
);

it("keeps the existing automatic-open behavior for a small imported note", async () => {
  const file = new File(["# Small"], "small.md");
  const imported = {
    id: "/vault/small.md",
    path: "/vault/small.md",
    name: "small.md",
    type: "file" as const,
  };
  mocks.refreshFileTree.mockImplementation(async () => {
    useAppStore.setState({ files: [previous, imported] });
  });
  render(<Harness />);
  await act(async () => operations.handleImportDroppedFiles("/vault", [file]));
  expect(useAppStore.getState().activeTabId).toBe(imported.id);
  expect(mocks.readFile).toHaveBeenCalledWith(imported);
});
