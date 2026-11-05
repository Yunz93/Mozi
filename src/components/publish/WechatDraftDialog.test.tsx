/** @vitest-environment happy-dom */

import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore, defaultSettings } from "../../store/appStore";

const {
  mockOpen,
  mockPrepare,
  mockHydrate,
  mockResolvePreview,
  mockSaveCover,
} = vi.hoisted(() => ({
  mockOpen: vi.fn(async () => "/covers/thumb.jpg"),
  mockPrepare: vi.fn(),
  mockHydrate: vi.fn(),
  mockResolvePreview: vi.fn(async (src: string) => `blob:cover-${src}`),
  mockSaveCover: vi.fn(async () => "/notes/resources/pasted-cover.png"),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: mockOpen,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => {}),
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
}));

vi.mock("../../types/filesystem", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../types/filesystem")>();
  return {
    ...actual,
    isTauriEnvironment: () => true,
  };
});

vi.mock("../../utils/wechatPublish", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../utils/wechatPublish")>();
  return {
    ...actual,
    prepareWechatDraftPublish: mockPrepare,
    hydrateWechatPreviewImages: mockHydrate,
  };
});

vi.mock("../../utils/previewImageCache", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../utils/previewImageCache")>();
  return {
    ...actual,
    resolvePreviewSource: mockResolvePreview,
  };
});

vi.mock("../../utils/wechatCoverImage", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../utils/wechatCoverImage")>();
  return {
    ...actual,
    savePastedCoverImage: mockSaveCover,
  };
});

import { WechatDraftDialog } from "./WechatDraftDialog";

const defaults = {
  title: "草稿标题",
  author: "作者",
  digest: "摘要",
  contentSourceUrl: "",
  showCoverPic: true,
  coverImagePath: "",
  existingDraftMediaId: "",
};

function seedStore() {
  useAppStore.setState({
    settings: { ...defaultSettings, language: "zh-CN" },
    currentFilePath: "/notes/post.md",
    rootFolderPath: "/notes",
    files: [
      {
        id: "/notes/post.md",
        name: "post.md",
        path: "/notes/post.md",
        type: "file",
      },
    ],
    activeTabId: "/notes/post.md",
    fileContents: {
      "/notes/post.md": "![图](cover.png)",
    },
  } as never);
}

describe("WechatDraftDialog", () => {
  beforeEach(() => {
    seedStore();
    mockOpen.mockResolvedValue("/covers/thumb.jpg");
    mockPrepare.mockResolvedValue({
      contentHtml: "<p>正文</p>",
      previewHtml: '<img src="/notes/cover.png" alt="图">',
      imageAssets: [
        {
          placeholder: "__WECHAT_LOCAL_IMAGE_1__",
          sourcePath: "/notes/cover.png",
        },
      ],
      unresolvedImages: [],
      defaultCoverImagePath: "/notes/cover.png",
    });
    mockHydrate.mockImplementation(async (html: string) =>
      html.replace("/notes/cover.png", "blob:preview-cover"),
    );
    mockResolvePreview.mockImplementation(
      async (src: string) => `blob:cover-${src}`,
    );
    mockSaveCover.mockResolvedValue("/notes/resources/pasted-cover.png");
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("keeps the draft submit button visible and disabled when the note has no image", async () => {
    mockPrepare.mockResolvedValue({
      contentHtml: "<p>正文</p>",
      previewHtml: "<p>正文</p>",
      imageAssets: [],
      unresolvedImages: [],
      defaultCoverImagePath: "",
    });
    render(
      <WechatDraftDialog
        isOpen
        isSubmitting={false}
        defaults={defaults}
        onClose={() => {}}
        onSubmit={() => {}}
      />,
    );

    const submit = await screen.findByRole("button", {
      name: "发布到草稿箱",
    });
    expect(submit).toBeTruthy();
    expect(submit).toHaveProperty("disabled", true);
    expect(screen.getByText("请先选择封面图后再发布。")).toBeTruthy();
    expect(document.querySelector(".wechat-draft-footer")).toBeTruthy();

    await waitFor(() => {
      expect(
        document.querySelector(".wechat-phone-preview")?.textContent,
      ).toContain("正文");
    });
  });

  it("enables publish after picking a cover and shows a cover thumbnail", async () => {
    const onSubmit = vi.fn();
    render(
      <WechatDraftDialog
        isOpen
        isSubmitting={false}
        defaults={defaults}
        onClose={() => {}}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "选择封面图" }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "发布到草稿箱" }),
      ).toHaveProperty("disabled", false);
    });

    expect(screen.queryByText("请先选择封面图后再发布。")).toBeNull();
    await waitFor(() => {
      expect(
        document.querySelector('img[src="blob:cover-/covers/thumb.jpg"]'),
      ).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "发布到草稿箱" }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "草稿标题",
          coverImagePath: "/covers/thumb.jpg",
        }),
      );
    });
  });

  it("keeps the chosen cover when publish defaults are rebuilt", async () => {
    const { rerender } = render(
      <WechatDraftDialog
        isOpen
        isSubmitting={false}
        defaults={defaults}
        onClose={() => {}}
        onSubmit={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "选择封面图" }));
    await waitFor(() => {
      expect(screen.getByText("/covers/thumb.jpg")).toBeTruthy();
    });

    rerender(
      <WechatDraftDialog
        isOpen
        isSubmitting={false}
        defaults={{ ...defaults, title: "草稿标题" }}
        onClose={() => {}}
        onSubmit={() => {}}
      />,
    );

    expect(screen.getByText("/covers/thumb.jpg")).toBeTruthy();
    expect(screen.getByRole("button", { name: "发布到草稿箱" })).toHaveProperty(
      "disabled",
      false,
    );
  });

  it("restores a persisted cover from note defaults", async () => {
    render(
      <WechatDraftDialog
        isOpen
        isSubmitting={false}
        defaults={{ ...defaults, coverImagePath: "/covers/saved.jpg" }}
        onClose={() => {}}
        onSubmit={() => {}}
      />,
    );

    expect(screen.getByText("/covers/saved.jpg")).toBeTruthy();
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "发布到草稿箱" }),
      ).toHaveProperty("disabled", false);
    });
  });

  it("persists the form when the dialog closes", () => {
    const onPersist = vi.fn();
    const onClose = vi.fn();
    render(
      <WechatDraftDialog
        isOpen
        isSubmitting={false}
        defaults={defaults}
        onClose={onClose}
        onPersist={onPersist}
        onSubmit={() => {}}
      />,
    );

    fireEvent.change(screen.getByDisplayValue("草稿标题"), {
      target: { value: "改过的标题" },
    });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(onPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "改过的标题",
        author: "作者",
        digest: "摘要",
      }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps helper tips below the form fields", async () => {
    render(
      <WechatDraftDialog
        isOpen
        isSubmitting={false}
        defaults={defaults}
        onClose={() => {}}
        onSubmit={() => {}}
      />,
    );

    const title = await screen.findByText("标题");
    const tips = document.querySelector(".wechat-draft-tips");
    expect(tips).toBeTruthy();
    expect(tips?.textContent).toContain("IP 不在白名单");
    expect(tips?.textContent).not.toContain("将上传");
    expect(tips?.textContent).not.toContain("张正文图片");
    expect(tips?.querySelector("ul")).toBeNull();
    expect(
      title.compareDocumentPosition(tips as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("does not list unresolved image paths in the helper tips", async () => {
    mockPrepare.mockResolvedValue({
      contentHtml: "<p>正文</p>",
      previewHtml: "<p>正文</p>",
      imageAssets: [],
      unresolvedImages: ["a.png", "b.png"],
    });

    render(
      <WechatDraftDialog
        isOpen
        isSubmitting={false}
        defaults={defaults}
        onClose={() => {}}
        onSubmit={() => {}}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByText("有图片找不到，修好路径后才能发布。"),
      ).toBeTruthy();
    });
    const tips = document.querySelector(".wechat-draft-tips");
    expect(tips?.textContent).not.toContain("a.png");
    expect(tips?.textContent).not.toContain("将上传");
    expect(tips?.querySelector("ul")).toBeNull();
  });

  it("keeps the preview image mounted while editing fields and refreshing publish metadata", async () => {
    render(
      <WechatDraftDialog
        isOpen
        isSubmitting={false}
        defaults={defaults}
        onClose={() => {}}
        onSubmit={() => {}}
      />,
    );
    await waitFor(() =>
      expect(document.querySelector(".wechat-phone-preview img")).toBeTruthy(),
    );
    const image = document.querySelector(".wechat-phone-preview img");
    fireEvent.change(screen.getByDisplayValue("作者"), {
      target: { value: "作者A" },
    });
    expect(document.querySelector(".wechat-phone-preview img")).toBe(image);

    let finishRefresh!: (value: unknown) => void;
    mockPrepare.mockReturnValueOnce(
      new Promise((resolve) => {
        finishRefresh = resolve;
      }),
    );
    act(() =>
      useAppStore.setState({
        fileContents: {
          "/notes/post.md": "---\ntitle: 草稿标题\n---\n![图](cover.png)",
        },
      }),
    );
    await waitFor(() => expect(mockPrepare).toHaveBeenCalledTimes(2));
    expect(document.querySelector(".wechat-phone-preview img")).toBe(image);
    await act(async () =>
      finishRefresh({
        contentHtml: "<p>正文</p>",
        previewHtml: '<img src="/notes/cover.png" alt="图">',
        imageAssets: [],
        unresolvedImages: [],
        defaultCoverImagePath: "/notes/cover.png",
      }),
    );
    await waitFor(() =>
      expect(document.querySelector(".wechat-phone-preview img")).toBe(image),
    );

    mockPrepare.mockRejectedValueOnce(new Error("refresh failed"));
    act(() =>
      useAppStore.setState({
        fileContents: {
          "/notes/post.md": "---\nauthor: 作者A\n---\n![图](cover.png)",
        },
      }),
    );
    await screen.findByRole("alert");
    expect(document.querySelector(".wechat-phone-preview img")).toBe(image);
    expect(screen.getByRole("button", { name: "发布到草稿箱" })).toHaveProperty(
      "disabled",
      true,
    );

    mockPrepare.mockReturnValueOnce(new Promise(() => {}));
    act(() =>
      useAppStore.setState({
        currentFilePath: "/notes/other.md",
        activeTabId: "/notes/other.md",
        fileContents: { "/notes/other.md": "# 另一篇笔记" },
      }),
    );
    await waitFor(() => expect(mockPrepare).toHaveBeenCalledTimes(4));
    expect(document.querySelector(".wechat-phone-preview img")).toBeNull();
  });

  it("keeps field focus borders inside the form scrollport", () => {
    render(
      <WechatDraftDialog
        isOpen
        isSubmitting={false}
        defaults={defaults}
        onClose={() => {}}
        onSubmit={() => {}}
      />,
    );
    const form = document.querySelector(".wechat-draft-form")!;
    const fields = form.querySelectorAll("input[type='text'], textarea");
    expect(fields.length).toBe(4);
    for (const field of fields)
      expect(field.classList.contains("wechat-draft-field")).toBe(true);
    expect(form.classList.contains("-mx-1")).toBe(false);
    const css = readFileSync(
      resolve(process.cwd(), "src/styles/components.css"),
      "utf8",
    );
    expect(css).toMatch(/\.wechat-draft-form\s*\{[^}]*padding:\s*0\.25rem/);
    expect(css).toMatch(
      /\.wechat-draft-field:focus\s*\{[^}]*box-shadow:\s*inset/,
    );
  });

  it("keeps focus in the author field after each keystroke", async () => {
    render(
      <WechatDraftDialog
        isOpen
        isSubmitting={false}
        defaults={defaults}
        onClose={() => {}}
        onSubmit={() => {}}
      />,
    );

    const author = screen.getByDisplayValue("作者") as HTMLInputElement;
    author.focus();
    fireEvent.change(author, { target: { value: "作者A" } });

    await waitFor(() => {
      expect(document.activeElement).toBe(author);
    });
    expect(author.value).toBe("作者A");
  });

  it("accepts a pasted image as the cover", async () => {
    render(
      <WechatDraftDialog
        isOpen
        isSubmitting={false}
        defaults={defaults}
        onClose={() => {}}
        onSubmit={() => {}}
      />,
    );

    const panel = document.querySelector(".publish-form-panel") as HTMLElement;
    const image = new File(["png"], "shot.png", { type: "image/png" });
    fireEvent.paste(panel, {
      clipboardData: {
        files: [image],
        items: [{ type: "image/png", getAsFile: () => image }],
        getData: () => "",
      },
    });

    await waitFor(() => {
      expect(mockSaveCover).toHaveBeenCalled();
      expect(
        screen.getByText("/notes/resources/pasted-cover.png"),
      ).toBeTruthy();
    });
  });
});
