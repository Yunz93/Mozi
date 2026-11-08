import { applyDocumentSessionEdit } from "../../services/documents/documentSession";
import React, { useMemo } from "react";
import { Dialog } from "../ui/Dialog";
import { useAppStore } from "../../store/appStore";
import { useI18n } from "../../hooks/useI18n";

/**
 * Review dialog for AI enhancement output. AI results are staged in
 * `pendingAiResult` instead of overwriting the note, and only applied after
 * an explicit user confirmation here.
 */
export const AiResultReviewDialog: React.FC = () => {
  const { t } = useI18n();
  const pendingAiResult = useAppStore((state) => state.pendingAiResult);
  const setPendingAiResult = useAppStore((state) => state.setPendingAiResult);
  const showNotification = useAppStore((state) => state.showNotification);

  const stats = useMemo(() => {
    if (!pendingAiResult) return null;
    return {
      before: pendingAiResult.previousContent.length,
      after: pendingAiResult.newContent.length,
    };
  }, [pendingAiResult]);

  if (!pendingAiResult) return null;

  const handleApply = () => {
    if (
      !applyDocumentSessionEdit({
        fileId: pendingAiResult.fileId,
        content: pendingAiResult.newContent,
        previousContent: pendingAiResult.previousContent,
        source: pendingAiResult.source,
      })
    ) {
      showNotification(t("notifications_aiApplyStale"), "error");
      setPendingAiResult(null);
      return;
    }
    setPendingAiResult(null);
    showNotification(t("notifications_aiEnhanced"), "success");
  };

  const handleDiscard = () => {
    setPendingAiResult(null);
  };

  return (
    <Dialog
      isOpen
      onClose={handleDiscard}
      title={t("ai_reviewTitle")}
      className="max-w-3xl"
      contentScroll={false}
    >
      <div className="flex min-h-0 flex-col gap-3">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {t("ai_reviewDescription")}
          {stats && (
            <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">
              {t("ai_reviewLengthChange", {
                before: stats.before,
                after: stats.after,
              })}
            </span>
          )}
        </p>
        <pre className="max-h-[52vh] overflow-auto whitespace-pre-wrap break-words rounded-xl border border-gray-200 bg-gray-50 p-4 font-mono text-xs leading-relaxed text-gray-800 dark:border-white/10 dark:bg-black/40 dark:text-gray-200">
          {pendingAiResult.newContent}
        </pre>
        <div className="flex justify-end gap-3 pt-1">
          <button
            onClick={handleDiscard}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            {t("ai_reviewDiscard")}
          </button>
          <button
            onClick={handleApply}
            className="inline-flex items-center gap-1.5 rounded-lg bg-black px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800 dark:bg-white dark:text-black dark:hover:bg-gray-100"
          >
            {t("ai_reviewApply")}
          </button>
        </div>
      </div>
    </Dialog>
  );
};
