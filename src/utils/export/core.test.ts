import { afterEach, describe, expect, it, vi } from "vitest";

const { save, writeTextFile, invoke } = vi.hoisted(() => ({
  save: vi.fn(async () => "/tmp/export.html"),
  writeTextFile: vi.fn(async () => {}),
  invoke: vi.fn(async () => {}),
}));

vi.mock("../../types/filesystem", () => ({
  isTauriEnvironment: () => true,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save,
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  writeFile: vi.fn(),
  writeTextFile,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke,
}));

import { saveExportFile } from "./core";

describe("saveExportFile", () => {
  afterEach(() => {
    save.mockClear();
    writeTextFile.mockClear();
    invoke.mockClear();
  });

  it("registers the saved path so Finder reveal is allowed", async () => {
    const path = await saveExportFile({
      content: "<html></html>",
      filename: "note",
      defaultExtension: ".html",
      mimeType: "text/html",
      description: "HTML",
    });

    expect(path).toBe("/tmp/export.html");
    expect(writeTextFile).toHaveBeenCalledWith(
      "/tmp/export.html",
      "<html></html>",
    );
    expect(invoke).toHaveBeenCalledWith("register_allowed_path", {
      path: "/tmp/export.html",
      recursive: false,
    });
  });
});
