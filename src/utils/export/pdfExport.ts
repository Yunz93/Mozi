import { saveExportFile } from "./core";
import type { ExportAttachmentContext } from "./attachments";
import {
  EXPORT_REQUESTED_RENDER_SCALE,
  buildHtml2CanvasRasterOptions,
  computeSafePdfRenderScale,
  disposeExportRasterHost,
  mountExportHtmlForRasterization,
  prepareExportRenderTargetForRasterization,
  restoreExportRasterHostStyles,
  revealExportRasterHostForCapture,
  withExportTimeout,
  yieldToEventLoopForRasterCapture,
} from "./exportRasterHost";
import { waitForNextPaint } from "./images";

/** Re-exported for backward compatibility with tests and external imports. */
export { computeSafePdfRenderScale } from "./exportRasterHost";

export const EXPORT_PDF_PREPARE_TIMEOUT_MS = 45_000;
export const EXPORT_PDF_RENDER_TIMEOUT_MS = 180_000;

/** Applied scale below this share of the requested scale is worth surfacing to the user. */
const SCALE_DEGRADATION_NOTIFY_RATIO = 0.6;

export interface ExportRenderScaleDegradation {
  requestedScale: number;
  appliedScale: number;
}

export interface ExportToPdfOptions {
  /**
   * Called when the render scale had to be reduced far below the requested
   * quality to keep the output canvas within platform limits (very long
   * documents). Lets the UI tell the user the PDF will look less sharp.
   */
  onScaleDegraded?: (info: ExportRenderScaleDegradation) => void;
}

export function notifyIfExportScaleDegraded(
  appliedScale: number,
  onScaleDegraded?: (info: ExportRenderScaleDegradation) => void,
  requestedScale: number = EXPORT_REQUESTED_RENDER_SCALE,
): void {
  if (!onScaleDegraded) return;
  if (appliedScale >= requestedScale * SCALE_DEGRADATION_NOTIFY_RATIO) return;
  onScaleDegraded({ requestedScale, appliedScale });
}

export async function exportToPdf(
  htmlContent: string,
  filename: string,
  sourceFilePath?: string,
  attachmentContext?: ExportAttachmentContext | null,
  options?: ExportToPdfOptions,
): Promise<string | null> {
  const { default: html2pdf } = await import("html2pdf.js");
  type Html2PdfWorker = InstanceType<typeof html2pdf.Worker>;
  type Html2PdfSetOptions = Parameters<Html2PdfWorker["set"]>[0];
  type Html2PdfPagebreakOptions = {
    pagebreak?: {
      mode?: Array<"avoid-all" | "css" | "legacy">;
    };
  };

  const { host, renderTarget, theme, backgroundColor } =
    mountExportHtmlForRasterization(htmlContent);

  try {
    await withExportTimeout(
      prepareExportRenderTargetForRasterization(
        renderTarget,
        theme,
        sourceFilePath,
        attachmentContext,
      ),
      EXPORT_PDF_PREPARE_TIMEOUT_MS,
      "PDF export timed out while preparing HTML",
    );

    const pdfOptions: Html2PdfSetOptions & Html2PdfPagebreakOptions = {
      margin: [12, 12, 12, 12],
      filename: filename.endsWith(".pdf") ? filename : `${filename}.pdf`,
      image: { type: "jpeg", quality: 0.92 },
      enableLinks: true,
      jsPDF: {
        unit: "mm",
        format: "a4",
        orientation: "portrait",
      },
      pagebreak: {
        mode: ["css", "legacy"],
      },
    };

    await yieldToEventLoopForRasterCapture();

    const hostStyleSnapshot = revealExportRasterHostForCapture(host);
    await waitForNextPaint(2);

    const worker = html2pdf()
      .set(pdfOptions as Html2PdfSetOptions)
      .from(renderTarget);

    let pdfArrayBuffer: ArrayBuffer;
    try {
      // PDF 克隆会按纸张宽度重新排版；背景与安全缩放都必须以克隆容器为准。
      const container: HTMLElement = await withExportTimeout(
        worker.toContainer().get("container"),
        EXPORT_PDF_PREPARE_TIMEOUT_MS,
        "PDF export timed out while preparing page layout",
      );
      container.style.backgroundColor = backgroundColor;
      const safeScale = computeSafePdfRenderScale(
        container.scrollWidth,
        container.scrollHeight,
      );
      notifyIfExportScaleDegraded(safeScale, options?.onScaleDegraded);
      const rasterOptions = buildHtml2CanvasRasterOptions({
        scale: safeScale,
        backgroundColor,
        renderTarget,
      });
      // 让 html2canvas 测量重新排版后的容器，避免按原尺寸截断或补出色块。
      delete rasterOptions.width;
      delete rasterOptions.height;
      const pdfWorker = worker.set({ html2canvas: rasterOptions }).toPdf();
      pdfArrayBuffer = await withExportTimeout(
        pdfWorker.outputPdf("arraybuffer"),
        EXPORT_PDF_RENDER_TIMEOUT_MS,
        "PDF export timed out while rendering",
      );
    } finally {
      restoreExportRasterHostStyles(host, hostStyleSnapshot);
    }

    return saveExportFile({
      content: new Uint8Array(pdfArrayBuffer),
      filename,
      defaultExtension: ".pdf",
      mimeType: "application/pdf",
      description: "PDF Document",
    });
  } finally {
    disposeExportRasterHost(host);
  }
}
