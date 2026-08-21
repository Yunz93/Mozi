import { describe, expect, it } from "vitest";
import type React from "react";
import {
  extractDroppedFiles,
  hasExternalFilePayload,
  isSkippedDropName,
  nextAvailableFileName,
  resolveSidebarDropIntent,
  sanitizeDroppedFileName,
  sanitizeDroppedRelativePath,
} from "./droppedFiles";

function createDragEvent(types: string[], files: File[] = []): React.DragEvent {
  return {
    dataTransfer: {
      types,
      files,
      items: [],
    },
  } as unknown as React.DragEvent;
}

describe("droppedFiles", () => {
  it("detects OS file drags from the Files type", () => {
    expect(hasExternalFilePayload(createDragEvent(["Files"]))).toBe(true);
    expect(
      hasExternalFilePayload(createDragEvent(["Files", "text/plain"])),
    ).toBe(true);
    expect(hasExternalFilePayload(createDragEvent(["text/plain"]))).toBe(false);
  });

  it("prefers importing OS files over an internal move payload", () => {
    const osDrop = createDragEvent(["Files", "text/plain"]);
    expect(resolveSidebarDropIntent(osDrop, true)).toBe("import-files");
    expect(
      resolveSidebarDropIntent(createDragEvent(["text/plain"]), true),
    ).toBe("move-node");
    expect(
      resolveSidebarDropIntent(createDragEvent(["text/uri-list"]), false),
    ).toBeNull();
  });

  it("extracts FileList entries from a drop event", () => {
    const note = new File(["# hi"], "note.md", { type: "text/markdown" });
    const event = createDragEvent(["Files"], [note]);
    expect(extractDroppedFiles(event).map((file) => file.name)).toEqual([
      "note.md",
    ]);
  });

  it("skips Finder/Explorer junk names", () => {
    expect(isSkippedDropName(".DS_Store")).toBe(true);
    expect(isSkippedDropName("Thumbs.db")).toBe(true);
    expect(isSkippedDropName("._hidden")).toBe(true);
    expect(isSkippedDropName("..")).toBe(true);
    expect(isSkippedDropName("note.md")).toBe(false);
  });

  it("sanitizes illegal filename characters", () => {
    expect(sanitizeDroppedFileName("a:b?.md")).toBe("a-b-.md");
    expect(sanitizeDroppedFileName("../secret.md")).toBe("secret.md");
    expect(sanitizeDroppedFileName(".DS_Store")).toBeNull();
  });

  it("rejects relative paths that escape the drop folder", () => {
    expect(sanitizeDroppedRelativePath("Notes/a.md")).toEqual([
      "Notes",
      "a.md",
    ]);
    expect(sanitizeDroppedRelativePath("../outside.md")).toBeNull();
    expect(sanitizeDroppedRelativePath("Notes/../a.md")).toBeNull();
  });

  it("allocates a unique name without overwriting", () => {
    const taken = new Set(["photo.png", "photo (1).png"]);
    expect(nextAvailableFileName("photo.png", taken)).toBe("photo (2).png");
    expect(nextAvailableFileName("note.md", taken)).toBe("note.md");
  });
});
