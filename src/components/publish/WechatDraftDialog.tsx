import React, { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { Dialog } from "../ui/Dialog";
import { useI18n } from "../../hooks/useI18n";
import { useAppStore, selectContent } from "../../store/appStore";
import { isTauriEnvironment } from "../../types/filesystem";
import {
  hydrateWechatPreviewImages,
  prepareWechatDraftPublish,
  type WechatDraftDefaults,
  type WechatDraftPublishInput,
} from "../../utils/wechatPublish";
import {
  isUsablePreviewDisplaySrc,
  resolvePreviewSource,
} from "../../utils/previewImageCache";

interface WechatDraftDialogProps {
  isOpen: boolean;
  isSubmitting: boolean;
  defaults: WechatDraftDefaults | null;
  onClose: () => void;
  onSubmit: (input: WechatDraftPublishInput) => void;
}

export const WechatDraftDialog: React.FC<WechatDraftDialogProps> = ({
  isOpen,
  isSubmitting,
  defaults,
  onClose,
  onSubmit,
}) => {
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [digest, setDigest] = useState("");
  const [contentSourceUrl, setContentSourceUrl] = useState("");
  const [showCoverPic, setShowCoverPic] = useState(true);
  const [coverImagePath, setCoverImagePath] = useState("");
  const [coverPreviewSrc, setCoverPreviewSrc] = useState("");
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const [imageCount, setImageCount] = useState(0);
  const [unresolvedImages, setUnresolvedImages] = useState<string[]>([]);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const previewRequestId = useRef(0);

  const files = useAppStore((state) => state.files);
  const rootFolderPath = useAppStore((state) => state.rootFolderPath);
  const currentFilePath = useAppStore((state) => state.currentFilePath);
  const markdownContent = useAppStore(selectContent);
  const settings = useAppStore((state) => state.settings);

  useEffect(() => {
    if (!isOpen || !defaults) {
      return;
    }

    setTitle(defaults.title);
    setAuthor(defaults.author);
    setDigest(defaults.digest);
    setContentSourceUrl(defaults.contentSourceUrl);
    setShowCoverPic(defaults.showCoverPic);
    setCoverImagePath("");
    setCoverPreviewSrc("");

    requestAnimationFrame(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    });
  }, [defaults, isOpen]);

  useEffect(() => {
    if (!isOpen || !currentFilePath || !markdownContent) {
      setPreviewHtml("");
      setImageCount(0);
      setUnresolvedImages([]);
      setPreviewError(false);
      setPreviewLoading(false);
      return;
    }

    const requestId = previewRequestId.current + 1;
    previewRequestId.current = requestId;
    setPreviewLoading(true);
    setPreviewError(false);

    void (async () => {
      try {
        const prepared = await prepareWechatDraftPublish({
          files,
          rootFolderPath,
          currentFilePath,
          markdownContent,
          settings,
        });
        if (previewRequestId.current !== requestId) return;
        const hydrated = await hydrateWechatPreviewImages(
          prepared.previewHtml,
          currentFilePath,
        );
        if (previewRequestId.current !== requestId) return;
        setPreviewHtml(hydrated);
        setImageCount(prepared.imageAssets.length);
        setUnresolvedImages(prepared.unresolvedImages.filter(Boolean));
      } catch {
        if (previewRequestId.current !== requestId) return;
        setPreviewHtml("");
        setImageCount(0);
        setUnresolvedImages([]);
        setPreviewError(true);
      } finally {
        if (previewRequestId.current === requestId) {
          setPreviewLoading(false);
        }
      }
    })();
  }, [
    isOpen,
    files,
    rootFolderPath,
    currentFilePath,
    markdownContent,
    settings,
  ]);

  useEffect(() => {
    if (!coverImagePath) {
      setCoverPreviewSrc("");
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const resolved = await resolvePreviewSource(coverImagePath);
        if (!cancelled && isUsablePreviewDisplaySrc(resolved)) {
          setCoverPreviewSrc(resolved);
        }
      } catch {
        if (!cancelled) {
          setCoverPreviewSrc("");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [coverImagePath]);

  const handlePickCover = async () => {
    if (!isTauriEnvironment()) {
      return;
    }

    const selected = await open({
      multiple: false,
      filters: [
        {
          name: "Images",
          extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp"],
        },
      ],
    });

    const path = typeof selected === "string" ? selected : null;
    if (!path) {
      return;
    }

    await invoke("register_allowed_path", { path, recursive: false });
    setCoverImagePath(path);
  };

  const handleSubmit = () => {
    onSubmit({
      title: title.trim(),
      author: author.trim(),
      digest: digest.trim(),
      contentSourceUrl: contentSourceUrl.trim(),
      showCoverPic,
      coverImagePath: coverImagePath.trim(),
      existingDraftMediaId: defaults?.existingDraftMediaId || "",
    });
  };

  const canSubmit =
    !isSubmitting &&
    Boolean(title.trim()) &&
    Boolean(coverImagePath.trim()) &&
    unresolvedImages.length === 0;

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={t("wechatDraftDialog_title")}
      className="max-w-5xl h-[88vh]"
      contentClassName="flex min-h-0 flex-col overflow-hidden py-3"
      contentScroll={false}
    >
      <div className="publish-form-panel flex min-h-0 h-full flex-col">
        <div className="wechat-draft-layout">
          <div className="wechat-draft-form -mx-1 min-w-0 space-y-3 px-1">
            <p className="text-xs leading-5 text-gray-500 dark:text-gray-400">
              {t("wechatDraftDialog_desc")}
            </p>
            <p className="text-xs leading-5 text-gray-500 dark:text-gray-400">
              {t("wechatDraftDialog_ipHint")}
            </p>

            {defaults?.existingDraftMediaId && (
              <div className="rounded-xl border border-emerald-200/70 bg-emerald-50/80 px-3 py-2 text-xs leading-5 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-200">
                {t("wechatDraftDialog_updateHint")}
              </div>
            )}

            {unresolvedImages.length > 0 ? (
              <div className="rounded-xl border border-amber-200/80 bg-amber-50/90 px-3 py-2 text-xs leading-5 text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-100">
                <p>
                  {t("wechatDraftDialog_unresolvedImages", {
                    count: unresolvedImages.length,
                  })}
                </p>
                <ul className="mt-1 list-disc pl-4">
                  {unresolvedImages.slice(0, 6).map((src) => (
                    <li key={src} className="break-all">
                      {src}
                    </li>
                  ))}
                </ul>
              </div>
            ) : imageCount > 0 ? (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t("wechatDraftDialog_imageCount", { count: imageCount })}
              </p>
            ) : null}

            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {t("wechatDraftDialog_titleLabel")}
              </label>
              <input
                ref={titleInputRef}
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="w-full rounded-xl border border-gray-200 dark:border-white/10 px-3 py-2 text-sm bg-white dark:bg-white/5 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-accent-DEFAULT/20 focus:border-accent-DEFAULT transition-all"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t("wechatDraftDialog_authorLabel")}
                </label>
                <input
                  type="text"
                  value={author}
                  onChange={(event) => setAuthor(event.target.value)}
                  className="w-full rounded-xl border border-gray-200 dark:border-white/10 px-3 py-2 text-sm bg-white dark:bg-white/5 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-accent-DEFAULT/20 focus:border-accent-DEFAULT transition-all"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t("wechatDraftDialog_sourceUrlLabel")}
                </label>
                <input
                  type="text"
                  value={contentSourceUrl}
                  onChange={(event) => setContentSourceUrl(event.target.value)}
                  placeholder="https://"
                  className="w-full rounded-xl border border-gray-200 dark:border-white/10 px-3 py-2 text-sm bg-white dark:bg-white/5 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-accent-DEFAULT/20 focus:border-accent-DEFAULT transition-all"
                />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {t("wechatDraftDialog_digestLabel")}
              </label>
              <textarea
                value={digest}
                onChange={(event) => setDigest(event.target.value)}
                rows={3}
                className="w-full rounded-xl border border-gray-200 dark:border-white/10 px-3 py-2 text-sm bg-white dark:bg-white/5 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-accent-DEFAULT/20 focus:border-accent-DEFAULT transition-all resize-y min-h-24"
              />
            </div>

            <div className="rounded-xl border border-gray-200/70 bg-white/70 px-3 py-3 dark:border-white/10 dark:bg-white/[0.03]">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex-1 min-w-56">
                  <div className="text-sm font-semibold text-gray-900 dark:text-white">
                    {t("wechatDraftDialog_coverLabel")}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
                    {t("wechatDraftDialog_coverDesc")}
                  </p>
                </div>
                <label className="inline-flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={showCoverPic}
                    onChange={(event) => setShowCoverPic(event.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-accent-DEFAULT focus:ring-accent-DEFAULT/30"
                  />
                  {t("wechatDraftDialog_showCover")}
                </label>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-3">
                {coverPreviewSrc ? (
                  <img
                    src={coverPreviewSrc}
                    alt=""
                    className="h-14 w-14 shrink-0 rounded-lg object-cover ring-1 ring-black/10 dark:ring-white/10"
                  />
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    void handlePickCover();
                  }}
                  className="inline-flex items-center gap-2 rounded-xl border border-gray-200/70 bg-white/85 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-black/5 dark:border-white/10 dark:bg-white/[0.03] dark:text-gray-200 dark:hover:bg-white/10"
                >
                  {t("wechatDraftDialog_pickCover")}
                </button>
                <span className="min-w-0 flex-1 truncate text-xs text-gray-500 dark:text-gray-400">
                  {coverImagePath || t("wechatDraftDialog_coverEmpty")}
                </span>
              </div>
            </div>
          </div>

          <aside
            className="wechat-draft-preview-pane"
            aria-label={t("wechatDraftDialog_previewTitle")}
          >
            <div className="mb-2">
              <div className="text-sm font-semibold text-gray-900 dark:text-white">
                {t("wechatDraftDialog_previewTitle")}
              </div>
              <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
                {t("wechatDraftDialog_previewHint")}
              </p>
            </div>
            <div className="wechat-phone-frame">
              {previewLoading ? (
                <p className="wechat-phone-empty">
                  {t("wechatDraftDialog_previewLoading")}
                </p>
              ) : previewError ? (
                <p className="wechat-phone-empty">
                  {t("wechatDraftDialog_previewFailed")}
                </p>
              ) : previewHtml ? (
                <div
                  className="wechat-phone-preview"
                  dangerouslySetInnerHTML={{ __html: previewHtml }}
                />
              ) : (
                <p className="wechat-phone-empty">
                  {t("wechatDraftDialog_previewFailed")}
                </p>
              )}
            </div>
          </aside>
        </div>

        <div className="wechat-draft-footer mt-3 flex shrink-0 flex-col items-end gap-2 border-t border-gray-200/50 pt-3 dark:border-white/10">
          {!coverImagePath.trim() ? (
            <p className="w-full text-right text-xs leading-5 text-amber-700 dark:text-amber-200">
              {t("wechatDraftDialog_coverRequired")}
            </p>
          ) : null}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="inline-flex items-center gap-1.5 rounded-xl bg-gray-100 dark:bg-gray-800 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 transition-colors hover:bg-gray-200 dark:hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {t("common_cancel")}
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="inline-flex items-center gap-1.5 rounded-xl bg-black dark:bg-white px-5 py-2 text-sm font-medium text-white dark:text-black transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 shadow-sm"
            >
              {isSubmitting
                ? t("toolbar_publishing")
                : t("wechatDraftDialog_submit")}
            </button>
          </div>
        </div>
      </div>
    </Dialog>
  );
};
