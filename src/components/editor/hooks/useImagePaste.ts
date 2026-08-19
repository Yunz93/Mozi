/**
 * Image Paste Hook
 *
 * 处理编辑器中的图片粘贴功能，支持本地保存和图床上传
 */

import { useCallback } from "react";
import type { EditorView } from "@codemirror/view";
import type {
  AppLanguage,
  AttachmentLocation,
  AttachmentPasteFormat,
} from "../../../types";
import { getFileSystem } from "../../../types/filesystem";
import { useAppStore } from "../../../store/appStore";
import { t } from "../../../utils/i18n";
import { joinFsPath, normalizeSlashes } from "../../../utils/pathHelpers";
import { resolveAttachmentTargetDir } from "../../../utils/attachmentLocation";
import { clearAttachmentResolverCache } from "../../../utils/attachmentResolver";
import { invalidateLivePreviewWikiCachesForPath } from "../livePreview/wiki";
import {
  isImageHostingEnabled,
  uploadImageToHosting,
} from "../../../services/imageHostingService";

export interface UseImagePasteOptions {
  rootFolderPath?: string | null;
  currentFilePath?: string | null;
  resourceFolder?: string;
  attachmentLocation?: AttachmentLocation;
  attachmentPasteFormat?: AttachmentPasteFormat;
  writeBinaryFile: (path: string, data: Uint8Array) => Promise<void>;
  refreshFileTree: () => Promise<void>;
  showNotification: (
    message: string,
    type?: "success" | "error" | "info",
  ) => void;
}

export interface UseImagePasteReturn {
  handlePastedImage: (file: File, view: EditorView) => Promise<boolean>;
}

function getImageExtension(mimeType: string): string {
  switch (mimeType.toLowerCase()) {
    case "image/jpeg":
      return "jpg";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
    case "image/svg+xml":
      return "svg";
    case "image/bmp":
      return "bmp";
    case "image/avif":
      return "avif";
    default:
      return "png";
  }
}

function buildPastedImageMarkdown(
  path: string,
  format: AttachmentPasteFormat,
): string {
  if (format === "markdown") {
    const fileName = path.split("/").filter(Boolean).pop() || "image";
    const altText = fileName.replace(/\.[^.]+$/, "").replace(/[[\]]/g, "\\$&");
    return `![${altText}](<${path}>)`;
  }

  return `![[${path}]]`;
}

function buildRemoteImageMarkdown(url: string, altText: string): string {
  return `![${altText}](${url})`;
}

function buildMarkdownImagePath(
  markdownRelativePathPrefix: string,
  imageName: string,
): string {
  if (!markdownRelativePathPrefix) {
    return imageName;
  }
  return normalizeSlashes(`${markdownRelativePathPrefix}/${imageName}`);
}

export function useImagePaste(
  options: UseImagePasteOptions,
): UseImagePasteReturn {
  const {
    rootFolderPath,
    currentFilePath,
    resourceFolder = "resources",
    attachmentLocation = "resourceFolder",
    attachmentPasteFormat = "obsidian",
    writeBinaryFile,
    refreshFileTree,
    showNotification,
  } = options;

  const resolveTarget = useCallback(() => {
    return resolveAttachmentTargetDir({
      location: attachmentLocation,
      rootFolderPath: rootFolderPath!,
      currentFilePath,
      resourceFolder,
    });
  }, [attachmentLocation, rootFolderPath, currentFilePath, resourceFolder]);

  const handleLocalMode = useCallback(
    async (
      view: EditorView,
      language: AppLanguage,
      arrayBuffer: ArrayBuffer,
      imageName: string,
    ): Promise<boolean> => {
      try {
        const { absoluteDir, markdownRelativePathPrefix } = resolveTarget();
        const imagePath = joinFsPath(absoluteDir, imageName);
        const imageMarkdownPath = buildMarkdownImagePath(
          markdownRelativePathPrefix,
          imageName,
        );

        const fileSystem = await getFileSystem();
        await fileSystem.createDirectory(absoluteDir);
        await writeBinaryFile(imagePath, new Uint8Array(arrayBuffer));
        await refreshFileTree();
        clearAttachmentResolverCache();
        invalidateLivePreviewWikiCachesForPath(imagePath);

        const insertText = buildPastedImageMarkdown(
          imageMarkdownPath,
          attachmentPasteFormat,
        );
        const selection = view.state.selection.main;
        view.dispatch({
          changes: {
            from: selection.from,
            to: selection.to,
            insert: insertText,
          },
          selection: { anchor: selection.from + insertText.length },
          scrollIntoView: true,
        });

        const folderLabel = markdownRelativePathPrefix || absoluteDir;
        showNotification(
          t(language, "notifications_imagePastedTo", { folder: folderLabel }),
          "success",
        );
        return true;
      } catch (error) {
        console.error("Failed to paste image attachment:", error);
        showNotification(
          t(language, "notifications_pasteImageFailed"),
          "error",
        );
        return false;
      }
    },
    [
      resolveTarget,
      attachmentPasteFormat,
      writeBinaryFile,
      refreshFileTree,
      showNotification,
    ],
  );

  const saveLocalCopy = useCallback(
    async (arrayBuffer: ArrayBuffer, imageName: string) => {
      const { absoluteDir } = resolveTarget();
      const imagePath = joinFsPath(absoluteDir, imageName);

      const fileSystem = await getFileSystem();
      await fileSystem.createDirectory(absoluteDir);
      await writeBinaryFile(imagePath, new Uint8Array(arrayBuffer));
      await refreshFileTree();
      clearAttachmentResolverCache();
      invalidateLivePreviewWikiCachesForPath(imagePath);
    },
    [resolveTarget, writeBinaryFile, refreshFileTree],
  );

  const handleUploadMode = useCallback(
    async (
      view: EditorView,
      settings: ReturnType<typeof useAppStore.getState>["settings"],
      language: AppLanguage,
      arrayBuffer: ArrayBuffer,
      imageName: string,
    ): Promise<boolean> => {
      const altText = imageName.replace(/\.[^.]+$/, "");
      const placeholder = `![Uploading ${imageName}...]()`;

      const selection = view.state.selection.main;
      view.dispatch({
        changes: {
          from: selection.from,
          to: selection.to,
          insert: placeholder,
        },
        selection: { anchor: selection.from + placeholder.length },
        scrollIntoView: true,
      });

      const placeholderFrom = selection.from;
      const placeholderTo = placeholderFrom + placeholder.length;

      try {
        const result = await uploadImageToHosting(
          arrayBuffer,
          imageName,
          settings,
        );
        const finalText = buildRemoteImageMarkdown(result.url, altText);

        const currentDoc = view.state.doc.toString();
        const currentPlaceholderStart = currentDoc.indexOf(placeholder);
        if (currentPlaceholderStart >= 0) {
          view.dispatch({
            changes: {
              from: currentPlaceholderStart,
              to: currentPlaceholderStart + placeholder.length,
              insert: finalText,
            },
          });
        } else {
          view.dispatch({
            changes: {
              from: placeholderFrom,
              to: Math.min(placeholderTo, view.state.doc.length),
              insert: finalText,
            },
          });
        }

        if (settings.imageHosting.keepLocalCopy) {
          saveLocalCopy(arrayBuffer, imageName).catch((err) =>
            console.warn("Failed to save local copy:", err),
          );
        }

        showNotification(t(language, "notifications_imageUploaded"), "success");
        return true;
      } catch (error) {
        console.error("Image hosting upload failed:", error);
        const detail = error instanceof Error ? error.message : String(error);
        showNotification(
          t(language, "notifications_imageUploadFailed", { error: detail }),
          "error",
        );

        const currentDoc = view.state.doc.toString();
        const currentPlaceholderStart = currentDoc.indexOf(placeholder);
        if (currentPlaceholderStart >= 0) {
          view.dispatch({
            changes: {
              from: currentPlaceholderStart,
              to: currentPlaceholderStart + placeholder.length,
              insert: "",
            },
          });
        }

        if (settings.imageHosting.keepLocalCopy) {
          return handleLocalMode(view, language, arrayBuffer, imageName);
        }

        return false;
      }
    },
    [handleLocalMode, saveLocalCopy, showNotification],
  );

  const handlePastedImage = useCallback(
    async (file: File, view: EditorView): Promise<boolean> => {
      const settings = useAppStore.getState().settings;
      const language = settings.language;

      if (!rootFolderPath) {
        showNotification(
          t(language, "notifications_openKnowledgeBaseBeforePastingImage"),
          "error",
        );
        return false;
      }

      const extension = getImageExtension(file.type);
      const noteBaseName =
        currentFilePath
          ?.split(/[\\/]/)
          .pop()
          ?.replace(/\.(md|markdown)$/i, "") || "image";
      const imageName = `${noteBaseName}-${Date.now()}.${extension}`;
      const arrayBuffer = await file.arrayBuffer();

      if (isImageHostingEnabled(settings)) {
        return handleUploadMode(
          view,
          settings,
          language,
          arrayBuffer,
          imageName,
        );
      }

      return handleLocalMode(view, language, arrayBuffer, imageName);
    },
    [
      rootFolderPath,
      currentFilePath,
      handleLocalMode,
      handleUploadMode,
      showNotification,
    ],
  );

  return { handlePastedImage };
}
