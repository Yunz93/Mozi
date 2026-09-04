/** @vitest-environment happy-dom */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as attachmentResolver from "../attachmentResolver";
import {
  enhanceExportAttachmentEmbeds,
  prepareHtmlForDownload,
} from "./attachments";
import * as shikiSnapshots from "../../components/editor/preview/shikiHtmlSnapshots";

describe("enhanceExportAttachmentEmbeds", () => {
  beforeEach(() => {
    vi.spyOn(attachmentResolver, "resolveAttachmentTarget").mockResolvedValue({
      path: "/vault/resources/poster.jpg",
      name: "poster.jpg",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes vault files and rootFolderPath into the resolver context", async () => {
    const spy = vi.spyOn(attachmentResolver, "createAttachmentResolverContext");
    const files = [
      {
        id: "1",
        name: "poster.jpg",
        type: "file" as const,
        path: "/vault/resources/poster.jpg",
      },
    ];
    const host = document.createElement("div");
    host.innerHTML = `<article class="markdown-body"><a class="markdown-embed" href="#" data-wiki-embed="true" data-wiki-target="poster.jpg" data-wikilink="poster.jpg" data-wiki-label="poster.jpg"></a></article>`;

    await enhanceExportAttachmentEmbeds(host, "/vault/notes/a.md", {
      files,
      rootFolderPath: "/vault",
    });

    expect(spy).toHaveBeenCalledWith(files, "/vault", "/vault/notes/a.md");
    const img = host.querySelector("img.preview-attachment-image");
    expect(img?.getAttribute("data-original-src")).toBe(
      "/vault/resources/poster.jpg",
    );
    expect(img?.getAttribute("src")).toBe("/vault/resources/poster.jpg");
  });

  it("applies wiki embed width from data-wiki-width", async () => {
    const host = document.createElement("div");
    host.innerHTML = `<article class="markdown-body"><a class="markdown-embed" href="#" data-wiki-embed="true" data-wiki-target="poster.jpg" data-wikilink="poster.jpg" data-wiki-label="poster.jpg" data-wiki-width="200"></a></article>`;

    await enhanceExportAttachmentEmbeds(host, "/vault/notes/a.md", {
      files: [],
      rootFolderPath: "/vault",
    });

    const img = host.querySelector(
      "img.preview-attachment-image",
    ) as HTMLImageElement | null;
    expect(img?.style.width).toBe("200px");
    expect(img?.getAttribute("data-wiki-embed-w")).toBe("200");
  });
});

describe("prepareHtmlForDownload shiki snapshots", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("protects and restores shiki inline styles across innerHTML readback", async () => {
    vi.spyOn(
      await import("../markdown-extensions"),
      "renderMermaidDiagrams",
    ).mockResolvedValue(undefined as never);
    vi.spyOn(await import("./images"), "prepareExportImages").mockResolvedValue(
      undefined as never,
    );
    vi.spyOn(await import("./images"), "waitForImages").mockResolvedValue(
      undefined as never,
    );
    vi.spyOn(await import("./images"), "waitForNextPaint").mockResolvedValue(
      undefined as never,
    );

    const protect = vi.spyOn(shikiSnapshots, "protectShikiPresInHtmlString");
    const restore = vi.spyOn(shikiSnapshots, "restoreShikiPresFromSnapshots");

    const html = `<!DOCTYPE html><html><head></head><body><pre class="shiki"><span style="color:#f00">x</span></pre></body></html>`;
    const out = await prepareHtmlForDownload(html);

    expect(protect).toHaveBeenCalled();
    expect(restore).toHaveBeenCalled();
    expect(out).toContain('style="color:#f00"');
  });
});
