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
import { useAppStore, defaultSettings } from "../../store/appStore";

const { mockOpen, mockPrepare, mockHydrate, mockResolvePreview } = vi.hoisted(
  () => ({
    mockOpen: vi.fn(async () => "/covers/thumb.jpg"),
    mockPrepare: vi.fn(),
    mockHydrate: vi.fn(),
    mockResolvePreview: vi.fn(async (src: string) => `blob:cover-${src}`),
  }),
);

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

import { WechatDraftDialog } from "./WechatDraftDialog";

const defaults = {
  title: "草稿标题",
  author: "作者",
  digest: "摘要",
  contentSourceUrl: "",
  showCoverPic: true,
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
    });
    mockHydrate.mockImplementation(async (html: string) =>
      html.replace("/notes/cover.png", "blob:preview-cover"),
    );
    mockResolvePreview.mockImplementation(
      async (src: string) => `blob:cover-${src}`,
    );
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("keeps the draft submit button visible and disabled until a cover is chosen", async () => {
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
        document
          .querySelector(".wechat-phone-preview img")
          ?.getAttribute("src"),
      ).toBe("blob:preview-cover");
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
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "草稿标题",
        coverImagePath: "/covers/thumb.jpg",
      }),
    );
  });
});
