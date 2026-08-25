/** @vitest-environment happy-dom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../types/filesystem", () => ({
  isTauriEnvironment: vi.fn(() => false),
  getFileSystem: vi.fn(async () => ({})),
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: vi.fn(async (path: string) => `asset://${path}`),
}));

vi.mock("@tauri-apps/api/path", () => ({
  dirname: vi.fn(async () => "/vault/notes"),
  join: vi.fn(async (...parts: string[]) => parts.join("/")),
  normalize: vi.fn(async (path: string) => path),
}));

import { isTauriEnvironment } from "../types/filesystem";
import {
  getCachedPreviewImageSrc,
  hydrateCachedPreviewImageSources,
  isUsablePreviewDisplaySrc,
  mountLazyPreviewImageWarming,
  previewSourceNeedsMaterialization,
  resolvePreviewSource,
  invalidateCachedPreviewImageSrc,
  rememberCachedPreviewImageSrc,
  refreshPreviewSource,
  warmPreviewImage,
} from "./previewImageCache";

describe("resolvePreviewSource", () => {
  beforeEach(() => {
    vi.mocked(isTauriEnvironment).mockReturnValue(false);
  });

  afterEach(async () => {
    const { getFileSystem } = await import("../types/filesystem");
    vi.mocked(getFileSystem).mockResolvedValue({} as never);
  });

  it("returns data and blob urls unchanged", async () => {
    await expect(
      resolvePreviewSource("data:image/png;base64,abc"),
    ).resolves.toBe("data:image/png;base64,abc");
    await expect(resolvePreviewSource("blob:abc")).resolves.toBe("blob:abc");
  });

  it("resolves relative image paths against the current note location in browser mode", async () => {
    const resolved = await resolvePreviewSource(
      "../img/poster.png",
      "/vault/notes/a.md",
    );
    expect(resolved).toContain("img/poster.png");
  });

  it("falls through when no filesystem is available instead of throwing", async () => {
    const { getFileSystem } = await import("../types/filesystem");
    vi.mocked(getFileSystem).mockRejectedValue(
      new Error("No supported file system available"),
    );

    const resolved = await resolvePreviewSource(
      "assets/poster.png",
      "/vault/notes/a.md",
    );
    expect(resolved).toContain("poster.png");
  });
});

describe("previewSourceNeedsMaterialization", () => {
  beforeEach(() => {
    vi.mocked(isTauriEnvironment).mockReturnValue(false);
  });

  it("is false for remote and in-memory sources", () => {
    expect(previewSourceNeedsMaterialization("https://cdn.example/a.png")).toBe(
      false,
    );
    expect(previewSourceNeedsMaterialization("blob:abc")).toBe(false);
    expect(previewSourceNeedsMaterialization("data:image/png;base64,abc")).toBe(
      false,
    );
  });

  it("is true for local paths in both browser and tauri", () => {
    expect(previewSourceNeedsMaterialization("/vault/img/a.png")).toBe(true);
    expect(
      previewSourceNeedsMaterialization(
        "/vault/resources/Pasted image 20260603161808.png",
      ),
    ).toBe(true);
    vi.mocked(isTauriEnvironment).mockReturnValue(true);
    expect(previewSourceNeedsMaterialization("/vault/img/a.png")).toBe(true);
    expect(
      previewSourceNeedsMaterialization(
        "resources/Pasted image 20260603161808.png",
      ),
    ).toBe(true);
  });
});

describe("isUsablePreviewDisplaySrc", () => {
  it("accepts http(s), data, and blob URLs", () => {
    expect(isUsablePreviewDisplaySrc("https://cdn.example/a.png")).toBe(true);
    expect(isUsablePreviewDisplaySrc("http://cdn.example/a.png")).toBe(true);
    expect(isUsablePreviewDisplaySrc("data:image/png;base64,abc")).toBe(true);
    expect(isUsablePreviewDisplaySrc("blob:abc")).toBe(true);
  });

  it("rejects local paths and Tauri asset/file protocols", () => {
    expect(isUsablePreviewDisplaySrc("/vault/img/a.png")).toBe(false);
    expect(isUsablePreviewDisplaySrc("asset://localhost/vault/img/a.png")).toBe(
      false,
    );
    expect(isUsablePreviewDisplaySrc("file:///vault/img/a.png")).toBe(false);
    expect(isUsablePreviewDisplaySrc("tauri://localhost/img.png")).toBe(false);
  });
});

describe("hydrateCachedPreviewImageSources", () => {
  afterEach(async () => {
    invalidateCachedPreviewImageSrc();
    vi.mocked(isTauriEnvironment).mockReturnValue(false);
    const { getFileSystem } = await import("../types/filesystem");
    vi.mocked(getFileSystem).mockResolvedValue({} as never);
  });

  it("returns html unchanged when there are no images", () => {
    expect(
      hydrateCachedPreviewImageSources("<p>plain</p>", "/vault/a.md"),
    ).toBe("<p>plain</p>");
  });

  it("leaves html unchanged when no warmed cache entry exists", () => {
    const html = '<img src="poster.png" data-original-src="poster.png" />';
    expect(hydrateCachedPreviewImageSources(html, "/vault/a.md")).toBe(html);
    expect(getCachedPreviewImageSrc("poster.png", "/vault/a.md")).toBeNull();
  });

  it("restores blob src when innerHTML dropped the object url", async () => {
    const { getFileSystem } = await import("../types/filesystem");
    vi.mocked(getFileSystem).mockResolvedValue({
      getFileObjectUrl: vi.fn(async () => "blob:restored-cjk-image"),
    } as never);
    vi.mocked(isTauriEnvironment).mockReturnValue(true);

    await warmPreviewImage(
      "/vault/resources/墨知正式版-1787151343910.png",
      "/vault/墨知正式版.md",
    );

    const html = hydrateCachedPreviewImageSources(
      '<img alt="墨知正式版-1787151343910.png" data-original-src="/vault/resources/墨知正式版-1787151343910.png" data-preview-warmed="true" />',
      "/vault/墨知正式版.md",
    );

    expect(html).toContain("blob:restored-cjk-image");
  });
});

describe("warmPreviewImage", () => {
  afterEach(async () => {
    invalidateCachedPreviewImageSrc();
    vi.restoreAllMocks();
    vi.mocked(isTauriEnvironment).mockReturnValue(false);
    const { getFileSystem } = await import("../types/filesystem");
    vi.mocked(getFileSystem).mockResolvedValue({} as never);
  });

  it("falls back to resolved source when blob fetch is unavailable", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("offline"));

    await expect(
      warmPreviewImage("assets/poster.png", "/vault/notes/a.md"),
    ).resolves.toContain("poster.png");
    expect(
      getCachedPreviewImageSrc("assets/poster.png", "/vault/notes/a.md"),
    ).toContain("poster.png");

    fetchSpy.mockRestore();
  });

  it("stores blob urls when fetch succeeds", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      blob: async () => new Blob(["image-bytes"], { type: "image/png" }),
    } as Response);
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:cached-image");

    await expect(
      warmPreviewImage("assets/remote.png", "/vault/notes/a.md"),
    ).resolves.toBe("blob:cached-image");
    expect(
      getCachedPreviewImageSrc("assets/remote.png", "/vault/notes/a.md"),
    ).toBe("blob:cached-image");

    fetchSpy.mockRestore();
    createObjectURL.mockRestore();
  });

  it("can drop cached entries when filesystem object urls are revoked", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      blob: async () => new Blob(["image-bytes"], { type: "image/png" }),
    } as Response);
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:to-revoke");

    await warmPreviewImage("/vault/resources/pasted.png", "/vault/notes/a.md");
    expect(
      getCachedPreviewImageSrc(
        "/vault/resources/pasted.png",
        "/vault/notes/a.md",
      ),
    ).toBe("blob:to-revoke");

    invalidateCachedPreviewImageSrc("/vault/resources/pasted.png");
    expect(
      getCachedPreviewImageSrc(
        "/vault/resources/pasted.png",
        "/vault/notes/a.md",
      ),
    ).toBeNull();

    fetchSpy.mockRestore();
    createObjectURL.mockRestore();
  });

  it("remembers display urls so live preview remounts can reuse them", () => {
    rememberCachedPreviewImageSrc(
      "墨知正式版.png",
      "/vault/notes/a.md",
      "blob:live-remount",
    );
    expect(
      getCachedPreviewImageSrc("墨知正式版.png", "/vault/notes/a.md"),
    ).toBe("blob:live-remount");
    invalidateCachedPreviewImageSrc();
    expect(
      getCachedPreviewImageSrc("墨知正式版.png", "/vault/notes/a.md"),
    ).toBeNull();
  });

  it("refreshes a local object url when the previous blob dies", async () => {
    const { getFileSystem } = await import("../types/filesystem");
    const getFileObjectUrl = vi.fn(async () => "blob:stale");
    const refreshFileObjectUrl = vi.fn(async () => "blob:fresh");
    vi.mocked(getFileSystem).mockResolvedValue({
      getFileObjectUrl,
      refreshFileObjectUrl,
    } as never);

    await expect(
      refreshPreviewSource("resources/poster.png", "/vault/notes/a.md"),
    ).resolves.toBe("blob:fresh");
    expect(refreshFileObjectUrl).toHaveBeenCalled();
    expect(
      getCachedPreviewImageSrc("resources/poster.png", "/vault/notes/a.md"),
    ).toBe("blob:fresh");
    invalidateCachedPreviewImageSrc();
  });
});

describe("resolvePreviewSource environment branches", () => {
  beforeEach(async () => {
    vi.mocked(isTauriEnvironment).mockReturnValue(false);
    const { getFileSystem } = await import("../types/filesystem");
    vi.mocked(getFileSystem).mockResolvedValue({} as never);
  });

  afterEach(async () => {
    invalidateCachedPreviewImageSrc();
    vi.mocked(isTauriEnvironment).mockReturnValue(false);
    const { getFileSystem } = await import("../types/filesystem");
    vi.mocked(getFileSystem).mockResolvedValue({} as never);
  });

  it("resolves file:// paths through the filesystem object url helper in browser mode", async () => {
    const { getFileSystem } = await import("../types/filesystem");
    vi.mocked(getFileSystem).mockResolvedValue({
      getFileObjectUrl: vi.fn(async (path: string) => `object:${path}`),
    } as never);

    await expect(
      resolvePreviewSource("file:///vault/img/poster.png"),
    ).resolves.toBe("object:/vault/img/poster.png");
  });

  it("uses filesystem object urls in tauri instead of broken asset protocol urls", async () => {
    vi.mocked(isTauriEnvironment).mockReturnValue(true);
    const { getFileSystem } = await import("../types/filesystem");
    const getFileObjectUrl = vi.fn(async (path: string) => `object:${path}`);
    vi.mocked(getFileSystem).mockResolvedValue({ getFileObjectUrl } as never);

    await expect(
      resolvePreviewSource("img/poster.png", "/vault/notes/a.md"),
    ).resolves.toBe("object:/vault/notes/img/poster.png");
    expect(getFileObjectUrl).toHaveBeenCalledWith(
      "/vault/notes/img/poster.png",
    );
  });

  it("loads pasted Obsidian-style filenames with spaces via object urls", async () => {
    vi.mocked(isTauriEnvironment).mockReturnValue(true);
    const { getFileSystem } = await import("../types/filesystem");
    const getFileObjectUrl = vi.fn(async (path: string) => `object:${path}`);
    vi.mocked(getFileSystem).mockResolvedValue({ getFileObjectUrl } as never);

    const pasted = "/vault/resources/Pasted image 20260603161808.png";
    await expect(resolvePreviewSource(pasted)).resolves.toBe(
      `object:${pasted}`,
    );
    expect(getFileObjectUrl).toHaveBeenCalledWith(pasted);
  });

  it("falls back to convertFileSrc only when object urls are unavailable", async () => {
    vi.mocked(isTauriEnvironment).mockReturnValue(true);
    const { getFileSystem } = await import("../types/filesystem");
    vi.mocked(getFileSystem).mockResolvedValue({} as never);

    await expect(
      resolvePreviewSource("img/poster.png", "/vault/notes/a.md"),
    ).resolves.toBe("asset:///vault/notes/img/poster.png");
  });

  it("does not cache asset protocol urls when object url lookup fails", async () => {
    vi.mocked(isTauriEnvironment).mockReturnValue(true);
    const { getFileSystem } = await import("../types/filesystem");
    const getFileObjectUrl = vi.fn(async () => {
      throw new Error("file not ready");
    });
    vi.mocked(getFileSystem).mockResolvedValue({ getFileObjectUrl } as never);

    await expect(
      resolvePreviewSource(
        "resources/墨知正式版-1787151343910.png",
        "/vault/墨知正式版.md",
      ),
    ).rejects.toThrow(/file not ready|Failed to read local preview image/);
    expect(isUsablePreviewDisplaySrc("asset:///vault/resources/x.png")).toBe(
      false,
    );
  });

  it("retries object url lookup after a newly pasted file misses the first read", async () => {
    vi.mocked(isTauriEnvironment).mockReturnValue(true);
    const { getFileSystem } = await import("../types/filesystem");
    const getFileObjectUrl = vi
      .fn()
      .mockRejectedValueOnce(new Error("ENOENT"))
      .mockResolvedValue("blob:pasted-image");
    vi.mocked(getFileSystem).mockResolvedValue({ getFileObjectUrl } as never);

    await expect(
      resolvePreviewSource("/vault/resources/墨知正式版-1787151343910.png"),
    ).resolves.toBe("blob:pasted-image");
    expect(getFileObjectUrl).toHaveBeenCalledTimes(2);
  });
});

describe("hydrateCachedPreviewImageSources cache hits", () => {
  it("rewrites img src when a warmed cache entry exists", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("offline"));
    await warmPreviewImage("assets/poster.png", "/vault/notes/a.md");

    const html = hydrateCachedPreviewImageSources(
      '<img src="assets/poster.png" data-original-src="assets/poster.png" />',
      "/vault/notes/a.md",
    );

    expect(html).toContain("assets/poster.png");
    expect(html).not.toBe(
      '<img src="assets/poster.png" data-original-src="assets/poster.png" />',
    );

    fetchSpy.mockRestore();
  });
});

describe("mountLazyPreviewImageWarming", () => {
  afterEach(async () => {
    invalidateCachedPreviewImageSrc();
    vi.restoreAllMocks();
    vi.mocked(isTauriEnvironment).mockReturnValue(false);
    const { getFileSystem } = await import("../types/filesystem");
    vi.mocked(getFileSystem).mockResolvedValue({} as never);
  });

  it("warms pending images when they intersect the viewport", async () => {
    const observers: Array<{
      callback: IntersectionObserverCallback;
      observe: (target: Element) => void;
    }> = [];

    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
        constructor(callback: IntersectionObserverCallback) {
          observers.push({ callback, observe: this.observe });
        }
      },
    );

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      blob: async () => new Blob(["image-bytes"], { type: "image/png" }),
    } as Response);
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:lazy-warmed");

    const host = document.createElement("div");
    const image = document.createElement("img");
    image.setAttribute("data-preview-warmed", "pending");
    image.setAttribute("data-original-src", "assets/lazy.png");
    image.setAttribute("data-preview-pending-src", "assets/lazy.png");
    host.appendChild(image);
    document.body.appendChild(host);

    const stop = mountLazyPreviewImageWarming(host, {
      sourceFilePath: "/vault/notes/a.md",
    });
    expect(observers).toHaveLength(1);
    expect(observers[0]?.observe).toHaveBeenCalledWith(image);

    observers[0]?.callback(
      [
        {
          isIntersecting: true,
          target: image,
          intersectionRatio: 1,
        } as unknown as IntersectionObserverEntry,
      ],
      observers[0] as unknown as IntersectionObserver,
    );

    await vi.waitFor(() => {
      expect(image.getAttribute("src")).toBe("blob:lazy-warmed");
      expect(image.getAttribute("data-preview-warmed")).toBe("true");
    });

    stop();
    fetchSpy.mockRestore();
    createObjectURL.mockRestore();
    host.remove();
  });

  it("rewarms images marked warmed whose src was stripped", async () => {
    const observers: Array<{
      callback: IntersectionObserverCallback;
      observe: (target: Element) => void;
    }> = [];

    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
        constructor(callback: IntersectionObserverCallback) {
          observers.push({ callback, observe: this.observe });
        }
      },
    );

    const { getFileSystem } = await import("../types/filesystem");
    vi.mocked(isTauriEnvironment).mockReturnValue(true);
    vi.mocked(getFileSystem).mockResolvedValue({
      getFileObjectUrl: vi.fn(async () => "blob:rewarmed-image"),
    } as never);

    const host = document.createElement("div");
    const image = document.createElement("img");
    image.alt = "墨知正式版-1787151343910.png";
    image.setAttribute("data-preview-warmed", "true");
    image.setAttribute(
      "data-original-src",
      "/vault/resources/墨知正式版-1787151343910.png",
    );
    host.appendChild(image);
    document.body.appendChild(host);

    const stop = mountLazyPreviewImageWarming(host, {
      sourceFilePath: "/vault/墨知正式版.md",
    });

    await vi.waitFor(() => {
      expect(image.getAttribute("src")).toBe("blob:rewarmed-image");
    });

    stop();
    host.remove();
  });
});
