// Export types
export type {
  ExportOptions,
  SaveExportOptions,
  ExportAttachmentContext,
} from "./types";
export { PREVIEW_PANEL_WIDTH_PX } from "./types";

// Export core utilities
export {
  escapeHtml,
  ensureFileExtension,
  isAbortLikeError,
  saveExportFile,
} from "./core";

// Export style utilities
export {
  buildExportStyles,
  buildExportDocument,
  renderProperties,
  generateTOC,
  injectExportHeadingIds,
} from "./styles";

// Export HTML export
export { exportToHtml, downloadHtml } from "./htmlExport";

// Export PDF export
export { exportToPdf, computeSafePdfRenderScale } from "./pdfExport";

// Long-image (PNG) export for sharing
export {
  rasterizeExportHtmlToPngBlob,
  exportLongImagePng,
} from "./longImageExport";

// Export image utilities
export {
  hasUrlScheme,
  isAbsoluteFilePath,
  decodeFileUrlPath,
  isRemoteHttpUrl,
  normalizeRemoteImageUrl,
  decodeLocalImageSource,
  resolveImageSource,
  prepareExportImages,
  waitForImages,
  waitForNextPaint,
  isImageAttachmentName,
} from "./images";

// Export attachment utilities
export {
  enhanceExportAttachmentEmbeds,
  prepareHtmlForDownload,
} from "./attachments";
