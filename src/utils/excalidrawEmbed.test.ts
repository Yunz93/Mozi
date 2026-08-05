/** @vitest-environment happy-dom */

import { describe, expect, it } from "vitest";
import { createEmptyExcalidrawDocument } from "./excalidrawDocument";
import { createExcalidrawEmbedContainer } from "./excalidrawEmbed";

describe("createExcalidrawEmbedContainer", () => {
  it("builds a pending embed host with path metadata", () => {
    const host = createExcalidrawEmbedContainer(document, {
      title: "board.excalidraw",
      path: "/vault/board.excalidraw",
      width: 480,
      height: 320,
    });

    expect(host.className).toContain("preview-attachment-excalidraw");
    expect(host.dataset.attachmentPath).toBe("/vault/board.excalidraw");
    expect(host.dataset.excalidrawState).toBe("pending");
    expect(host.style.width).toBe("480px");
    expect(host.style.height).toBe("320px");
    expect(createEmptyExcalidrawDocument()).toContain('"type": "excalidraw"');
  });
});
