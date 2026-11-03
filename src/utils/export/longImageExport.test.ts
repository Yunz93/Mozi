/** @vitest-environment happy-dom */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canvasToPngBlob,
  rasterizeExportHtmlToPngBlob,
} from "./longImageExport";

const { rasterize, dimensions } = vi.hoisted(() => ({
  rasterize: vi.fn(),
  dimensions: { width: 832, height: 1000 },
}));
vi.mock("html2canvas", () => ({ default: rasterize }));
vi.mock("../platform", () => ({ getPlatformIdentifier: () => "windows" }));
vi.mock("./images", () => ({ waitForNextPaint: vi.fn(async () => {}) }));
vi.mock("./exportRasterHost", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./exportRasterHost")>()),
  prepareExportRenderTargetForRasterization: vi.fn(
    async (target: HTMLElement) => {
      Object.defineProperties(target, {
        scrollWidth: { value: dimensions.width },
        scrollHeight: { value: dimensions.height },
      });
    },
  ),
  yieldToEventLoopForRasterCapture: vi.fn(async () => {}),
}));

describe("canvasToPngBlob", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects when the browser never calls toBlob", async () => {
    vi.useFakeTimers();
    const canvas = document.createElement("canvas");
    Object.defineProperty(canvas, "toBlob", {
      configurable: true,
      value: vi.fn(),
    });

    const pending = expect(canvasToPngBlob(canvas, 1000)).rejects.toThrow(
      "Long image export timed out while encoding PNG",
    );
    await vi.advanceTimersByTimeAsync(1000);

    await pending;
  });

  it("rejects when toBlob returns an empty PNG blob", async () => {
    const canvas = document.createElement("canvas");
    Object.defineProperty(canvas, "toBlob", {
      configurable: true,
      value: vi.fn((callback: BlobCallback) => callback(null)),
    });

    await expect(canvasToPngBlob(canvas)).rejects.toThrow(
      "Long image export failed: empty PNG blob",
    );
  });
});

describe("long image raster size guard", () => {
  afterEach(() => {
    rasterize.mockReset();
    document.body.innerHTML = "";
    dimensions.width = 832;
    dimensions.height = 1000;
  });

  it("renders a normal document and removes the temporary host", async () => {
    rasterize.mockResolvedValue({
      toBlob: (callback: BlobCallback) =>
        callback(new Blob(["png"], { type: "image/png" })),
    });
    const blob = await rasterizeExportHtmlToPngBlob(
      '<html><head></head><body><div class="export-document">Visible note</div></body></html>',
    );
    expect(await blob.text()).toBe("png");
    expect(rasterize).toHaveBeenCalledOnce();
    expect(document.querySelector(".mp-export-raster-host")).toBeNull();
  });

  it("rejects an oversized image before allocating a canvas and cleans up", async () => {
    dimensions.height = 200_000;
    await expect(
      rasterizeExportHtmlToPngBlob(
        '<html><head></head><body><div class="export-document">Too long</div></body></html>',
      ),
    ).rejects.toThrow(/too large.*split/i);
    expect(rasterize).not.toHaveBeenCalled();
    expect(document.querySelector(".mp-export-raster-host")).toBeNull();
    expect(document.getElementById("mp-export-raster-styles")).toBeNull();
  });
});
