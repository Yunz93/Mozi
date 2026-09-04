import React, { useEffect, useMemo, useRef, useState } from "react";
import { Dialog } from "../ui/Dialog";
import { useI18n } from "../../hooks/useI18n";
import type {
  SimpleBlogPublishDefaults,
  SimpleBlogPublishInput,
} from "../../utils/simpleBlogPublish";

interface SimpleBlogPublishDialogProps {
  isOpen: boolean;
  isSubmitting: boolean;
  defaults: SimpleBlogPublishDefaults | null;
  localImagesToRepo?: boolean;
  onClose: () => void;
  onSubmit: (input: SimpleBlogPublishInput) => void;
}

export const SimpleBlogPublishDialog: React.FC<
  SimpleBlogPublishDialogProps
> = ({
  isOpen,
  isSubmitting,
  defaults,
  localImagesToRepo = false,
  onClose,
  onSubmit,
}) => {
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [aliases, setAliases] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen || !defaults) {
      return;
    }

    setTitle(defaults.title);
    setSlug(defaults.slug);
    setAliases(defaults.aliases);

    requestAnimationFrame(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    });
  }, [defaults, isOpen]);

  const canSubmit = useMemo(() => Boolean(title.trim()), [title]);

  const handleSubmit = () => {
    if (!canSubmit || isSubmitting) {
      return;
    }

    onSubmit({
      title: title.trim(),
      slug: slug.trim(),
      aliases: aliases.trim(),
    });
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={t("simpleBlogDialog_title")}
      className="max-w-2xl"
      contentClassName="py-3"
      contentScroll
      closable={!isSubmitting}
    >
      <div className="publish-form-panel flex min-h-0 h-full flex-col">
        <div className="-mx-1 space-y-3 px-1">
          <p className="text-xs leading-5 text-gray-500 dark:text-gray-400">
            {t("simpleBlogDialog_desc")}
          </p>
          {localImagesToRepo ? (
            <p className="text-xs leading-5 text-amber-700 dark:text-amber-300">
              {t("simpleBlogDialog_localImagesToRepo")}
            </p>
          ) : null}

          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t("simpleBlogDialog_titleLabel")}
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
                {t("simpleBlogDialog_slugLabel")}
              </label>
              <input
                type="text"
                value={slug}
                onChange={(event) => setSlug(event.target.value)}
                className="w-full rounded-xl border border-gray-200 dark:border-white/10 px-3 py-2 text-sm bg-white dark:bg-white/5 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-accent-DEFAULT/20 focus:border-accent-DEFAULT transition-all"
              />
              <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                {t("simpleBlogDialog_slugDesc")}
              </p>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {t("simpleBlogDialog_aliasesLabel")}
              </label>
              <input
                type="text"
                value={aliases}
                onChange={(event) => setAliases(event.target.value)}
                className="w-full rounded-xl border border-gray-200 dark:border-white/10 px-3 py-2 text-sm bg-white dark:bg-white/5 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-accent-DEFAULT/20 focus:border-accent-DEFAULT transition-all"
              />
              <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                {t("simpleBlogDialog_aliasesDesc")}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-3 flex shrink-0 justify-end gap-3 border-t border-gray-200/50 pt-3 dark:border-white/10">
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
            disabled={isSubmitting || !canSubmit}
            className="inline-flex items-center gap-1.5 rounded-xl bg-black dark:bg-white px-5 py-2 text-sm font-medium text-white dark:text-black transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 shadow-sm"
          >
            {isSubmitting
              ? t("toolbar_publishing")
              : t("simpleBlogDialog_submit")}
          </button>
        </div>
      </div>
    </Dialog>
  );
};
