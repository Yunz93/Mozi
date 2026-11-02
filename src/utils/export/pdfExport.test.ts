/** @vitest-environment happy-dom */

import { afterEach, describe, expect, it, vi } from "vitest";

const { worker, saveExportFile } = vi.hoisted(() => {
  const worker = {
    set: vi.fn(),
    from: vi.fn(),
    toContainer: vi.fn(),
    get: vi.fn(async () => document.createElement("div")),
    toPdf: vi.fn(),
    outputPdf: vi.fn(async () => new ArrayBuffer(8)),
  };
  worker.set.mockReturnValue(worker);
  worker.from.mockReturnValue(worker);
  worker.toContainer.mockReturnValue(worker);
  worker.toPdf.mockReturnValue(worker);
  return { worker, saveExportFile: vi.fn(async () => "/export/test.pdf") };
});

vi.mock("html2pdf.js", () => ({ default: () => worker }));
vi.mock("./core", () => ({ saveExportFile }));
vi.mock("./images", () => ({ waitForNextPaint: vi.fn(async () => {}) }));
vi.mock("./exportRasterHost", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./exportRasterHost")>()),
  prepareExportRenderTargetForRasterization: vi.fn(async () => {}),
  yieldToEventLoopForRasterCapture: vi.fn(async () => {}),
}));

import { exportToPdf } from "./pdfExport";

describe("PDF clone layout", () => {
  afterEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  it.each([
    ["dark", "#0d1117"],
    ["light", "#ffffff"],
  ])(
    "keeps the %s theme background when html2pdf clones the document",
    async (theme, color) => {
      await exportToPdf(
        `<html data-theme="${theme}"><head></head><body><div class="export-document"><p>Visible content</p></div></body></html>`,
        "test",
      );
      const target = worker.from.mock.calls[0][0] as HTMLElement;
      expect(target.textContent).toBe("Visible content");
      const container = await worker.get.mock.results[0].value;
      expect(container.style.backgroundColor).toBe(color);
      expect(saveExportFile).toHaveBeenCalledWith(
        expect.objectContaining({ mimeType: "application/pdf" }),
      );
    },
  );

  it("lets html2canvas measure the PDF clone after page-width reflow", async () => {
    await exportToPdf(
      '<html><head></head><body><div class="export-document"><p>Reflowed content</p></div></body></html>',
      "test",
    );
    const options = worker.set.mock.calls.at(-1)![0].html2canvas;
    expect(options.scale).toBeGreaterThan(0);
    expect(options).not.toHaveProperty("width");
    expect(options).not.toHaveProperty("height");
    expect(worker.outputPdf).toHaveBeenCalledWith("arraybuffer");
  });

  it("limits raster scale using the reflowed PDF container height", async () => {
    const container = document.createElement("div");
    Object.defineProperties(container, {
      scrollWidth: { value: 703 },
      scrollHeight: { value: 20000 },
    });
    worker.get.mockResolvedValueOnce(container);
    await exportToPdf(
      '<html><head></head><body><div class="export-document">Long document</div></body></html>',
      "test",
    );
    expect(worker.set.mock.calls.at(-1)![0].html2canvas.scale).toBeCloseTo(0.7);
  });
});
