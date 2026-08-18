import React, { useCallback, useEffect, useRef, useState } from "react";
import { Dialog } from "../ui/Dialog";
import { useI18n } from "../../hooks/useI18n";
import { useAppStore } from "../../store/appStore";
import { rasterizeExportHtmlToPngBlob } from "../../utils/export/longImageExport";
import {
  disposeAllExportRasterArtifacts,
  withExportTimeout,
} from "../../utils/export/exportRasterHost";
import { saveExportFile } from "../../utils/export/core";
import type { ExportAttachmentContext } from "../../utils/export/attachments";
import { getFileSystem, isTauriEnvironment } from "../../types/filesystem";
import type { LongImageSharePayload } from "./longImageSharePayload";
import {
  classifyExportError,
  EXPORT_ERROR_I18N_KEYS,
} from "../../utils/export/exportErrors";

interface ShareLongImageDialogProps {
  isOpen: boolean;
  onClose: () => void;
  buildPayload: () => Promise<LongImageSharePayload | null>;
  attachmentContext: ExportAttachmentContext;
}

const LONG_IMAGE_PAYLOAD_TIMEOUT_MS = 30_000;

export const ShareLongImageDialog: React.FC<ShareLongImageDialogProps> = ({
  isOpen,
  onClose,
  buildPayload,
  attachmentContext,
}) => {
  const { t } = useI18n();
  const showNotification = useAppStore((s) => s.showNotification);

  const [generating, setGenerating] = useState(false);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const filenameBaseRef = useRef("export");
  const generationSessionRef = useRef(0);

  useEffect(() => {
    if (!isOpen) {
      generationSessionRef.current += 1;
      disposeAllExportRasterArtifacts();
      setGenerating(false);
      setSaving(false);
      setBlob(null);
      filenameBaseRef.current = "export";
      setPreviewUrl((prev) => {
        if (prev) {
          URL.revokeObjectURL(prev);
        }
        return null;
      });
    }
  }, [isOpen]);

  const handleGenerate = useCallback(async () => {
    const sessionId = ++generationSessionRef.current;
    setGenerating(true);
    try {
      const payload = await withExportTimeout(
        buildPayload(),
        LONG_IMAGE_PAYLOAD_TIMEOUT_MS,
        "Long image export timed out while building HTML",
      );
      if (!payload || sessionId !== generationSessionRef.current) {
        return;
      }
      const nextBlob = await rasterizeExportHtmlToPngBlob(
        payload.html,
        payload.sourceFilePath,
        attachmentContext,
        {
          onScaleDegraded: () => {
            showNotification(
              t("notifications_exportQualityReduced"),
              "warning",
            );
          },
        },
      );
      if (sessionId !== generationSessionRef.current) {
        return;
      }
      filenameBaseRef.current = payload.filenameBase || "export";
      setBlob(nextBlob);
      setPreviewUrl((prev) => {
        if (prev) {
          URL.revokeObjectURL(prev);
        }
        return URL.createObjectURL(nextBlob);
      });
    } catch (error) {
      if (sessionId !== generationSessionRef.current) {
        return;
      }
      console.error("Long image export failed:", error);
      const kind = classifyExportError(
        error instanceof Error ? error.message : String(error),
      );
      showNotification(
        t(
          kind === "generic"
            ? "notifications_longImageExportFailed"
            : EXPORT_ERROR_I18N_KEYS[kind],
        ),
        "error",
      );
    } finally {
      if (sessionId === generationSessionRef.current) {
        setGenerating(false);
      }
    }
  }, [attachmentContext, buildPayload, showNotification, t]);

  const handleSave = useCallback(async () => {
    if (!blob) return;
    setSaving(true);
    try {
      const base = filenameBaseRef.current || "export";
      const savedPath = await saveExportFile({
        content: new Uint8Array(await blob.arrayBuffer()),
        filename: `${base}.png`,
        defaultExtension: ".png",
        mimeType: "image/png",
        description: "PNG Image",
      });
      if (savedPath !== null) {
        showNotification(t("notifications_longImageExported"), "success");
        if (savedPath && isTauriEnvironment()) {
          try {
            const fs = await getFileSystem();
            await fs.revealInExplorer?.(savedPath);
          } catch {
            /* best-effort */
          }
        }
      }
    } catch (error) {
      console.error("Save long image failed:", error);
      showNotification(t("notifications_longImageExportFailed"), "error");
    } finally {
      setSaving(false);
    }
  }, [blob, showNotification, t]);

  const handleCopy = useCallback(async () => {
    if (!blob) return;
    try {
      if (!navigator.clipboard || !window.ClipboardItem) {
        showNotification(t("notifications_longImageCopyFailed"), "error");
        return;
      }
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob }),
      ]);
      showNotification(t("notifications_longImageCopied"), "success");
    } catch (error) {
      console.error("Copy long image failed:", error);
      showNotification(t("notifications_longImageCopyFailed"), "error");
    }
  }, [blob, showNotification, t]);

  const handleSystemShare = useCallback(async () => {
    if (!blob) return;
    const file = new File([blob], "share.png", { type: "image/png" });
    if (!navigator.share) {
      showNotification(t("notifications_longImageShareUnsupported"), "info");
      return;
    }
    try {
      const data: ShareData = { files: [file] };
      if (navigator.canShare && !navigator.canShare(data)) {
        showNotification(t("notifications_longImageShareUnsupported"), "info");
        return;
      }
      await navigator.share(data);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      console.error("System share failed:", error);
      showNotification(t("notifications_longImageShareFailed"), "error");
    }
  }, [blob, showNotification, t]);

  const canUseSystemShare =
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    typeof window.File !== "undefined";

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={t("share_longImageTitle")}
      className="max-w-3xl w-[min(100vw-2rem,52rem)]"
    >
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        {t("share_longImageDesc")}
      </p>

      <div className="flex flex-wrap gap-2 mb-4">
        <button
          type="button"
          disabled={generating}
          onClick={() => {
            void handleGenerate();
          }}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-black text-white dark:bg-white dark:text-black hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {generating ? (
            <>
              <span className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white dark:border-black/30 dark:border-t-black animate-spin" />
              {t("share_generating")}
            </>
          ) : (
            t("share_generate")
          )}
        </button>

        <button
          type="button"
          disabled={!blob || saving}
          onClick={() => {
            void handleSave();
          }}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg border border-gray-200 dark:border-white/15 bg-white/90 dark:bg-white/5 text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-white/10 disabled:opacity-40 transition-colors"
        >
          {t("share_savePng")}
        </button>

        <button
          type="button"
          disabled={!blob}
          onClick={() => {
            void handleCopy();
          }}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg border border-gray-200 dark:border-white/15 bg-white/90 dark:bg-white/5 text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-white/10 disabled:opacity-40 transition-colors"
        >
          {t("share_copyImage")}
        </button>

        {canUseSystemShare && (
          <button
            type="button"
            disabled={!blob}
            onClick={() => {
              void handleSystemShare();
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg border border-gray-200 dark:border-white/15 bg-white/90 dark:bg-white/5 text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-white/10 disabled:opacity-40 transition-colors"
          >
            {t("share_systemShare")}
          </button>
        )}
      </div>

      {previewUrl && (
        <div className="min-h-0 max-h-[min(60vh,32rem)] overflow-y-auto overscroll-contain rounded-xl border border-gray-200/80 dark:border-white/10 bg-gray-50/80 dark:bg-black/40">
          <img
            src={previewUrl}
            alt={t("share_previewAlt")}
            className="block max-w-full h-auto mx-auto"
            draggable={false}
          />
        </div>
      )}
    </Dialog>
  );
};
