import { useCallback } from "react";
import { useAppStore, selectContent } from "../store/appStore";
import { exportToHtml, downloadHtml, exportToPdf } from "../utils/export";
import type { LongImageSharePayload } from "../components/share/longImageSharePayload";
import {
  buildCodeExportFontFamily,
  buildPreviewExportFontFamily,
} from "../utils/fontSettings";
import { getFileSystem } from "../types/filesystem";
import { t } from "../utils/i18n";
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
      showNotification(
        t(settings.language, "notifications_exportPdfFailed"),
        "error",
      );
    }
  }, [
    activeTabId,
    content,
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
      showNotification(
        t(settings.language, "notifications_exportHtmlFailed"),
        "error",
      );
    }
  }, [
    activeTabId,
    content,
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
      });

      return {
        html: htmlContent,
        filenameBase: activeFile.name.replace(/\.md$/i, ""),
        sourceFilePath: activeFile.path,
      };
    }, [
      activeTabId,
      codeFontFamily,
      content,
      files,
      highlighter,
      previewFontFamily,
      settings.fontSize,
      settings.language,
      settings.markdownStylePreset,
      settings.orderedListMode,
      settings.themeMode,
      showNotification,
    ]);

  return {
    handleExportToPdf,
    handleExportToHtml,
    buildLongImageSharePayload,
  };
}
