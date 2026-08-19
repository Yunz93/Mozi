/** @vitest-environment happy-dom */

import React, { useEffect, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { usePreviewRenderer } from "./usePreviewRenderer";
import * as shikiSnapshots from "../preview/shikiHtmlSnapshots";
import * as previewRenderCore from "../preview/previewRenderCore";

// Some markdown utilities rely on Vite global defines.
(globalThis as any).__PROD__ ??= false;

vi.mock("../../../utils/previewImageCache", async () => {
  return {
    resolvePreviewSource: vi.fn(async (src: string) => src),
    warmPreviewImage: vi.fn(async (src: string) => src),
    getCachedPreviewImageSrc: vi.fn(() => null),
    previewSourceNeedsMaterialization: vi.fn(() => false),
    mountLazyPreviewImageWarming: vi.fn(() => () => {}),
    hydrateCachedPreviewImageSources: vi.fn((html: string) => html),
    isUsablePreviewDisplaySrc: (src: string) =>
      Boolean(src?.trim()) &&
      !src.trim().startsWith("asset:") &&
      !src.trim().startsWith("tauri:"),
  };
});

vi.mock("../../../utils/attachmentResolver", () => ({
  createAttachmentResolverContext: vi.fn(() => ({})),
  resolveAttachmentTarget: vi.fn(async () => null),
}));

function Harness(props: { html: string; isMarkdownPreview?: boolean }) {
  const renderer = usePreviewRenderer({
    content: props.html,
    currentFilePath: "/vault/note.md",
    isMarkdownPreview: props.isMarkdownPreview ?? false,
    isHtmlPreview: !props.isMarkdownPreview,
    highlighter: null,
    themeMode: "light",
    files: [],
    rootFolderPath: "/vault",
    fileContents: {},
    activeTabId: "tab",
    readFile: async () => "",
  });

  const [html, setHtml] = useState(() => renderer.enhancedBodyHtml);

  useEffect(() => {
    setHtml(renderer.enhancedBodyHtml);
  }, [renderer.enhancedBodyHtml]);

  return <div data-testid="out" dangerouslySetInnerHTML={{ __html: html }} />;
}

describe("usePreviewRenderer (Shiki protect/restore integration)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("restores Shiki <pre> blocks after async enhancement readback", async () => {
    const shikiPre = [
      '<pre class="shiki markdown-press-light" style="background-color:#f8fafc"><code>',
      '<span style="color:#C2410C">const</span>',
      "</code></pre>",
    ].join("");

    // Includes <img> to ensure async enhancement path runs.
    const html = `<section><p>before</p>${shikiPre}<img src="data:image/png;base64,AA==" /><p>after</p></section>`;

    render(<Harness html={html} />);

    await waitFor(() => {
      const out = screen.getByTestId("out");
      expect(out.innerHTML).toContain('<pre class="shiki');
      expect(out.innerHTML).toContain("color:#C2410C");
      expect(out.innerHTML).not.toContain("data-mp-shiki-slot=");
    });
  });

  it("restores shiki blocks during markdown async enhancement", async () => {
    const shikiPre =
      '<pre class="shiki markdown-press-light"><code><span style="color:#abc">fn</span></code></pre>';

    vi.spyOn(previewRenderCore, "renderMarkdownPreview").mockReturnValue({
      frontmatter: null,
      bodyHTML: `${shikiPre}<p><img src="poster.png" /></p>`,
    });

    render(<Harness html="# Title" isMarkdownPreview />);

    await waitFor(() => {
      const out = screen.getByTestId("out");
      expect(out.innerHTML).toContain("color:#abc");
      expect(out.innerHTML).not.toContain("data-mp-shiki-slot=");
    });
  });

  it("keeps shiki colors when protect/restore runs through the snapshot helpers directly", () => {
    const shikiPre =
      '<pre class="shiki"><code><span style="color:#00ff00">ok</span></code></pre>';
    const snapshots: string[] = [];
    const protectedHtml = shikiSnapshots.protectShikiPresInHtmlString(
      `<img src="x.png" />${shikiPre}`,
      snapshots,
    );
    const readback = protectedHtml.replace(
      /<img[^>]*>/,
      '<img src="blob:x" />',
    );
    const restored = shikiSnapshots.restoreShikiPresFromSnapshots(
      readback,
      snapshots,
    );

    expect(restored).toContain("color:#00ff00");
    expect(restored).not.toContain("data-mp-shiki-slot=");
  });
});
