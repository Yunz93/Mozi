import React from "react";
import { Dialog } from "../ui/Dialog";
import { useI18n } from "../../hooks/useI18n";

interface PublishTargetDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectSimpleBlog: () => void;
  onSelectWechatDraft: () => void;
}

export const PublishTargetDialog: React.FC<PublishTargetDialogProps> = ({
  isOpen,
  onClose,
  onSelectSimpleBlog,
  onSelectWechatDraft,
}) => {
  const { t } = useI18n();

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={t("publish_targetTitle")}
      className="max-w-lg"
    >
      <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
        {t("publish_targetDesc")}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={onSelectWechatDraft}
          className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4 text-left transition-colors hover:border-gray-300 hover:bg-gray-100 dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-white/20 dark:hover:bg-white/[0.06]"
        >
          <div className="text-sm font-semibold text-gray-900 dark:text-white">
            {t("publish_targetWechatDraft")}
          </div>
          <p className="mt-2 text-xs leading-5 text-gray-500 dark:text-gray-400">
            {t("publish_targetWechatDraftDesc")}
          </p>
        </button>

        <button
          type="button"
          onClick={onSelectSimpleBlog}
          className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4 text-left transition-colors hover:border-gray-300 hover:bg-gray-100 dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-white/20 dark:hover:bg-white/[0.06]"
        >
          <div className="text-sm font-semibold text-gray-900 dark:text-white">
            {t("publish_targetSimpleBlog")}
          </div>
          <p className="mt-2 text-xs leading-5 text-gray-500 dark:text-gray-400">
            {t("publish_targetSimpleBlogDesc")}
          </p>
        </button>
      </div>
    </Dialog>
  );
};
