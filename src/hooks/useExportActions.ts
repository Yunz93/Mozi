import { useCallback, useRef, useState } from "react";

type ExportFlightListener = () => void;
let exportInFlight = false;
const exportFlightListeners = new Set<ExportFlightListener>();

export function getExportInFlight(): boolean {
  return exportInFlight;
}

export function subscribeExportInFlight(
  listener: ExportFlightListener,
): () => void {
  exportFlightListeners.add(listener);
  return () => {
    exportFlightListeners.delete(listener);
  };
}

function setExportInFlight(next: boolean): void {
  if (exportInFlight === next) return;
  exportInFlight = next;
  exportFlightListeners.forEach((listener) => listener());
}
import { useAppStore, selectContent } from "../store/appStore";
import { exportToHtml, downloadHtml, exportToPdf } from "../utils/export";
import type { LongImageSharePayload } from "../components/share/longImageSharePayload";
import {
  buildCodeExportFontFamily,
  buildPreviewExportFontFamily,
} from "../utils/fontSettings";
import { getFileSystem } from "../types/filesystem";
import { t } from "../utils/i18n";
import {
  getScaledCodeFontSize,
  getScaledEditorFontSize,
} from "../utils/uiFontSize";
import {
  classifyExportError,
  EXPORT_ERROR_I18N_KEYS,
} from "../utils/export/exportErrors";
import type { ShikiHighlighter } from "../hooks/useShikiHighlighter";
import { findFileInTree } from "../utils/fileTree";
import {
  isExcalidrawWorkspaceFile,
  isMarkdownFile,
  isPreviewOnlyFile,
} from "../utils/fileTypes";

function isNonMarkdownExportFile(
  name: string,
  content?: string | null,
): boolean {
  return isPreviewOnlyFile(name) || isExcalidrawWorkspaceFile(name, content);
}

/**
 * Encapsulates export actions (PDF + long-image share payload).
 * Publish actions live in usePublishActions.
 */
export function useExportActions(highlighter?: ShikiHighlighter | null) {
  const { files, activeTabId, rootFolderPath, settings, showNotification } =
    useAppStore();
  const content = useAppStore(selectContent);
  const previewFontFamily = buildPreviewExportFontFamily(settings);
  const codeFontFamily = buildCodeExportFontFamily(settings);
  const exportInFlightRef = useRef(false);
  const [isExporting, setIsExporting] = useState(false);

  const beginExport = useCallback((): boolean => {
    if (exportInFlightRef.current) {
      showNotification(t(settings.language, "export_exporting"), "info");
      return false;
    }
    exportInFlightRef.current = true;
    setExportInFlight(true);
    setIsExporting(true);
    return true;
  }, [settings.language, showNotification]);

  const endExport = useCallback(() => {
    exportInFlightRef.current = false;
    setExportInFlight(false);
    setIsExporting(false);
  }, []);

  const handleExportToPdf = useCallback(async () => {
    if (
      !activeTabId ||
      useAppStore.getState().fileContents[activeTabId] === undefined
    ) {
      showNotification(
        t(settings.language, "notifications_noFileToExport"),
        "error",
      );
      return;
    }

    const activeFile = findFileInTree(files, activeTabId);
    if (!activeFile) {
      showNotification(
        t(settings.language, "notifications_noFileToExport"),
        "error",
      );
      return;
    }

    if (isNonMarkdownExportFile(activeFile.name, content)) {
      showNotification(
        t(settings.language, "notifications_exportMarkdownOnly"),
        "error",
      );
      return;
    }

    if (!beginExport()) return;

    try {
      const htmlContent = await exportToHtml(content, {
        title: activeFile.name.replace(".md", ""),
        theme: settings.themeMode,
        includeTOC: false,
        fontFamily: previewFontFamily,
        codeFontFamily,
        fontSettings: settings,
        fontSize: settings.fontSize,
        codeFontSize: Math.max(12, settings.fontSize - 2),
        includeProperties: false,
        highlighter,
        markdownStylePreset: settings.markdownStylePreset,
        orderedListMode: settings.orderedListMode,
        language: settings.language,
      });
      const savedPath = await exportToPdf(
        htmlContent,
        activeFile.name,
        activeFile.path,
        {
          files,
          rootFolderPath,
        },
        {
          onScaleDegraded: () => {
            showNotification(
              t(settings.language, "notifications_exportQualityReduced"),
              "warning",
            );
          },
        },
      );
      if (savedPath !== null) {
        showNotification(
          t(settings.language, "notifications_pdfExported"),
          "success",
        );
        if (savedPath) {
          try {
            const fs = await getFileSystem();
            await fs.revealInExplorer?.(savedPath);
          } catch {
            /* best-effort */
          }
        }
      }
    } catch (error) {
      console.error("Failed to export PDF:", error);
      const kind = classifyExportError(
        error instanceof Error ? error.message : String(error),
      );
      showNotification(
        t(
          settings.language,
          kind === "generic"
            ? "notifications_exportPdfFailed"
            : EXPORT_ERROR_I18N_KEYS[kind],
        ),
        "error",
      );
    } finally {
      endExport();
    }
  }, [
    activeTabId,
    beginExport,
    content,
    endExport,
    files,
    rootFolderPath,
    previewFontFamily,
    codeFontFamily,
    highlighter,
    settings.fontSize,
    settings.language,
    settings.markdownStylePreset,
    settings.orderedListMode,
    settings.themeMode,
    showNotification,
  ]);

  const handleExportToHtml = useCallback(async () => {
    if (
      !activeTabId ||
      useAppStore.getState().fileContents[activeTabId] === undefined
    ) {
      showNotification(
        t(settings.language, "notifications_noFileToExport"),
        "error",
      );
      return;
    }

    const activeFile = findFileInTree(files, activeTabId);
    if (!activeFile) {
      showNotification(
        t(settings.language, "notifications_noFileToExport"),
        "error",
      );
      return;
    }

    if (
      isNonMarkdownExportFile(activeFile.name, content) ||
      !isMarkdownFile(activeFile.name)
    ) {
      showNotification(
        t(settings.language, "notifications_exportMarkdownOnly"),
        "error",
      );
      return;
    }

    if (!beginExport()) return;

    try {
      const htmlContent = await exportToHtml(content, {
        title: activeFile.name.replace(".md", ""),
        theme: settings.themeMode,
        includeTOC: false,
        fontFamily: previewFontFamily,
        codeFontFamily,
        fontSettings: settings,
        fontSize: settings.fontSize,
        codeFontSize: Math.max(12, settings.fontSize - 2),
        includeProperties: false,
        highlighter,
        markdownStylePreset: settings.markdownStylePreset,
        orderedListMode: settings.orderedListMode,
        language: settings.language,
      });
      const filename =
        activeFile.name.replace(/\.(md|markdown)$/i, "") || "export";
      const savedPath = await downloadHtml(
        htmlContent,
        filename,
        activeFile.path,
        {
          files,
          rootFolderPath,
        },
      );
      if (savedPath !== null) {
        showNotification(
          t(settings.language, "notifications_htmlExported"),
          "success",
        );
        if (savedPath) {
          try {
            const fs = await getFileSystem();
            await fs.revealInExplorer?.(savedPath);
          } catch {
            /* best-effort */
          }
        }
      }
    } catch (error) {
      console.error("Failed to export HTML:", error);
      const kind = classifyExportError(
        error instanceof Error ? error.message : String(error),
      );
      showNotification(
        t(
          settings.language,
          kind === "generic"
            ? "notifications_exportHtmlFailed"
            : EXPORT_ERROR_I18N_KEYS[kind],
        ),
        "error",
      );
    } finally {
      endExport();
    }
  }, [
    activeTabId,
    beginExport,
    content,
    endExport,
    files,
    rootFolderPath,
    previewFontFamily,
    codeFontFamily,
    highlighter,
    settings.fontSize,
    settings.language,
    settings.markdownStylePreset,
    settings.orderedListMode,
    settings.themeMode,
    showNotification,
  ]);

  const buildLongImageSharePayload =
    useCallback(async (): Promise<LongImageSharePayload | null> => {
      if (
        !activeTabId ||
        useAppStore.getState().fileContents[activeTabId] === undefined
      ) {
        showNotification(
          t(settings.language, "notifications_noFileToExport"),
          "error",
        );
        return null;
      }

      const activeFile = findFileInTree(files, activeTabId);
      if (!activeFile || isNonMarkdownExportFile(activeFile.name, content)) {
        showNotification(
          t(settings.language, "notifications_exportMarkdownOnly"),
          "error",
        );
        return null;
      }

      if (!beginExport()) return null;

      try {
        const htmlContent = await exportToHtml(content, {
          title: activeFile.name.replace(".md", ""),
          theme: settings.themeMode,
          includeTOC: false,
          fontFamily: previewFontFamily,
          codeFontFamily,
          fontSettings: settings,
          fontSize: getScaledEditorFontSize(
            settings.fontSize,
            settings.uiFontSize,
          ),
          codeFontSize: getScaledCodeFontSize(
            settings.fontSize,
            settings.uiFontSize,
          ),
          includeProperties: false,
          highlighter,
          markdownStylePreset: settings.markdownStylePreset,
          orderedListMode: settings.orderedListMode,
          language: settings.language,
        });

        return {
          html: htmlContent,
          filenameBase: activeFile.name.replace(/\.md$/i, ""),
          sourceFilePath: activeFile.path,
        };
      } finally {
        endExport();
      }
    }, [
      activeTabId,
      beginExport,
      codeFontFamily,
      content,
      endExport,
      files,
      highlighter,
      previewFontFamily,
      settings.fontSize,
      settings.language,
      settings.markdownStylePreset,
      settings.orderedListMode,
      settings.themeMode,
      settings.uiFontSize,
      showNotification,
    ]);

  return {
    handleExportToPdf,
    handleExportToHtml,
    buildLongImageSharePayload,
    isExporting,
  };
}
