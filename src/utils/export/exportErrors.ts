export type ExportErrorKind =
  | "timeout"
  | "emptyBlob"
  | "tooLarge"
  | "prepare"
  | "rasterize"
  | "generic";

export const EXPORT_ERROR_I18N_KEYS: Record<
  ExportErrorKind,
  | "notifications_exportTimedOut"
  | "notifications_exportEmptyOutput"
  | "notifications_exportTooLarge"
  | "notifications_exportPrepareFailed"
  | "notifications_exportRasterFailed"
  | "notifications_longImageExportFailed"
> = {
  timeout: "notifications_exportTimedOut",
  emptyBlob: "notifications_exportEmptyOutput",
  tooLarge: "notifications_exportTooLarge",
  prepare: "notifications_exportPrepareFailed",
  rasterize: "notifications_exportRasterFailed",
  generic: "notifications_longImageExportFailed",
};

/**
 * Classify long-image / PDF / HTML export failures from existing Error messages
 * (timeouts, empty canvas, scale/size clamps) so toasts can tell the user what to do.
 */
export function classifyExportError(message: string): ExportErrorKind {
  const normalized = message.trim();
  if (!normalized) return "generic";

  if (/timed out/i.test(normalized) || /timeout/i.test(normalized)) {
    return "timeout";
  }
  if (/empty blob/i.test(normalized) || /blank canvas/i.test(normalized)) {
    return "emptyBlob";
  }
  if (
    /too large/i.test(normalized) ||
    /max canvas/i.test(normalized) ||
    /exceeds.*dimension/i.test(normalized) ||
    /out of memory/i.test(normalized) ||
    /allocation failed/i.test(normalized)
  ) {
    return "tooLarge";
  }
  if (/preparing html/i.test(normalized) || /building html/i.test(normalized)) {
    return "prepare";
  }
  if (
    /rasteriz/i.test(normalized) ||
    /encoding png/i.test(normalized) ||
    /html2canvas/i.test(normalized) ||
    /while rendering/i.test(normalized)
  ) {
    return "rasterize";
  }
  return "generic";
}
