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
  mountLazyPreviewImageWarming,
  previewSourceNeedsMaterialization,
  resolvePreviewSource,
  invalidateCachedPreviewImageSrc,
  warmPreviewImage,
} from "./previewImageCache";

describe("resolvePreviewSource", () => {
  beforeEach(() => {
    vi.mocked(isTauriEnvironment).mockReturnValue(false);
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

describe("hydrateCachedPreviewImageSources", () => {
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
});

describe("warmPreviewImage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
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
});

describe("resolvePreviewSource environment branches", () => {
  beforeEach(async () => {
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
  afterEach(() => {
    vi.restoreAllMocks();
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
});
