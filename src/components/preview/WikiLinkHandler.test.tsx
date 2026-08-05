/** @vitest-environment happy-dom */

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { AttachmentEmbed, WikiLinkHandler } from "./WikiLinkHandler";

vi.mock("../../hooks/useI18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("../../utils/attachmentResolver", () => ({
  resolveAttachmentTarget: vi.fn(),
}));

vi.mock("../../utils/previewImageCache", () => ({
  warmPreviewImage: vi.fn(),
  resolvePreviewSource: vi.fn(),
  hydrateCachedPreviewImageSources: vi.fn((html: string) => html),
}));

import { resolveAttachmentTarget } from "../../utils/attachmentResolver";

const mockedResolveAttachmentTarget = vi.mocked(resolveAttachmentTarget);

const attachmentContext = {
  cacheNamespace: "test-vault",
  files: [],
  rootFolderPath: "/vault",
  currentFilePath: "/vault/notes/a.md",
};

describe("WikiLinkHandler", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("prevents default navigation and delegates to onNavigate", async () => {
    const onNavigate = vi.fn(async () => {});

    render(
      <WikiLinkHandler
        target="Other Note"
        currentFilePath="/vault/notes/a.md"
        attachmentResolverContext={attachmentContext}
        onNavigate={onNavigate}
      >
        Other Note
      </WikiLinkHandler>,
    );

    fireEvent.click(screen.getByText("Other Note"));
    expect(onNavigate).toHaveBeenCalledWith("Other Note");
  });
});

describe("AttachmentEmbed", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders a missing attachment placeholder", async () => {
    mockedResolveAttachmentTarget.mockResolvedValue(null);

    render(
      <AttachmentEmbed
        target="missing.png"
        currentFilePath="/vault/notes/a.md"
        attachmentResolverContext={attachmentContext}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/Missing attachment:/)).toBeTruthy();
    });
  });

  it("renders an image attachment when resolved", async () => {
    mockedResolveAttachmentTarget.mockResolvedValue({
      path: "/vault/img/poster.png",
      name: "poster.png",
    });

    render(
      <AttachmentEmbed
        target="img/poster.png"
        embedWidth={240}
        currentFilePath="/vault/notes/a.md"
        attachmentResolverContext={attachmentContext}
      />,
    );

    await waitFor(() => {
      const image = document.querySelector(
        "img.preview-attachment-image",
      ) as HTMLImageElement | null;
      expect(image).toBeTruthy();
      expect(image?.getAttribute("src")).toBe("/vault/img/poster.png");
      expect(image?.style.width).toBe("240px");
    });
  });

  it("renders a note embed with markdown html", async () => {
    mockedResolveAttachmentTarget.mockResolvedValue({
      path: "/vault/notes/other.md",
      name: "other.md",
    });

    render(
      <AttachmentEmbed
        target="other.md"
        currentFilePath="/vault/notes/a.md"
        attachmentResolverContext={attachmentContext}
        readFile={async () => "# Other\n\nBody"}
        renderMarkdown={() => "<p>Body</p>"}
      />,
    );

    await waitFor(() => {
      expect(document.querySelector(".preview-note-embed")).toBeTruthy();
      expect(
        document.querySelector(".preview-note-embed-body")?.innerHTML,
      ).toContain("<p>Body</p>");
    });
  });

  it("blocks embedding the entire current note into itself", async () => {
    mockedResolveAttachmentTarget.mockResolvedValue({
      path: "/vault/notes/a.md",
      name: "a.md",
    });

    render(
      <AttachmentEmbed
        target="a.md"
        currentFilePath="/vault/notes/a.md"
        attachmentResolverContext={attachmentContext}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByText("Cannot embed the entire current note into itself"),
      ).toBeTruthy();
    });
  });

  it("renders a generic file chip for unknown attachment types", async () => {
    mockedResolveAttachmentTarget.mockResolvedValue({
      path: "/vault/archive/data.zip",
      name: "data.zip",
    });

    render(
      <AttachmentEmbed
        target="archive/data.zip"
        currentFilePath="/vault/notes/a.md"
        attachmentResolverContext={attachmentContext}
      />,
    );

    await waitFor(() => {
      const chip = document.querySelector(
        "a.preview-attachment-file",
      ) as HTMLAnchorElement | null;
      expect(chip?.dataset.attachmentPath).toBe("/vault/archive/data.zip");
      expect(
        chip?.querySelector(".preview-attachment-file-name")?.textContent,
      ).toBe("data.zip");
    });
  });

  it("renders a pdf attachment iframe when resolved", async () => {
    mockedResolveAttachmentTarget.mockResolvedValue({
      path: "/vault/papers/saycan.pdf",
      name: "saycan.pdf",
    });

    render(
      <AttachmentEmbed
        target="papers/saycan.pdf"
        embedWidth={480}
        embedHeight={640}
        currentFilePath="/vault/notes/a.md"
        attachmentResolverContext={attachmentContext}
      />,
    );

    await waitFor(() => {
      const pdf = document.querySelector(
        "iframe.preview-attachment-pdf",
      ) as HTMLIFrameElement | null;
      expect(pdf).toBeTruthy();
      expect(pdf?.getAttribute("src")).toContain("/vault/papers/saycan.pdf");
      expect(pdf?.style.width).toBe("480px");
      expect(pdf?.style.height).toBe("640px");
    });
  });

  it("renders a sanitized HTML attachment preview when resolved", async () => {
    mockedResolveAttachmentTarget.mockResolvedValue({
      path: "/vault/resources/card.html",
      name: "card.html",
    });

    render(
      <AttachmentEmbed
        target="resources/card.html"
        embedWidth={360}
        embedHeight={240}
        currentFilePath="/vault/notes/a.md"
        attachmentResolverContext={attachmentContext}
        readFile={async () =>
          '<h1>Card</h1><p>Hello <img src="x" onerror="alert(1)"></p>'
        }
      />,
    );

    await waitFor(() => {
      const html = document.querySelector(
        ".preview-attachment-html.preview-html-document",
      ) as HTMLElement | null;
      expect(html).toBeTruthy();
      expect(html?.dataset.htmlPath).toBe("/vault/resources/card.html");
      expect(html?.textContent).toContain("Card");
      expect(html?.textContent).toContain("Hello");
      expect(html?.innerHTML).not.toContain("onerror");
      expect(html?.style.width).toBe("360px");
      expect(html?.style.height).toBe("240px");
    });
  });
});
